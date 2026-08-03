import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AgeGroup, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// Integrasjonstest mot en ekte Nest-app + ekte Postgres (samme oppsett som auth.e2e-spec.ts).
// Kjør infrastrukturen først: `npm run infra:up`, deretter `npm run test:backend:e2e`.
describe('Articles (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const runId = Date.now();
  const editorEmail = `e2e-editor-${runId}@example.com`;
  const freeEmail = `e2e-free-${runId}@example.com`;
  const password = 'supersecret123';
  const categorySlug = `e2e-kategori-${runId}`;

  let editorToken: string;
  let freeToken: string;
  let categoryId: string;
  let draftArticleId: string;
  let lockedArticleId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);

    // Kategorien opprettes direkte via Prisma (ikke POST /categories) for å holde dette testoppsettet
    // fokusert på artikkel-logikken - kategori-endepunktet har sin egen dekning senere.
    const category = await prisma.category.create({ data: { name: 'E2E Kategori', slug: categorySlug } });
    categoryId = category.id;

    const editorRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'E2E Editor', email: editorEmail, password });
    editorToken = editorRes.body.accessToken;
    // register() setter alltid FREE (håndheves i AuthService) - en EDITOR-bruker kan derfor kun
    // oppstå ved at en admin oppgraderer rollen i etterkant. Her simulerer vi det direkte i DB siden
    // vi ennå ikke har bygget et admin-endepunkt for brukerhåndtering.
    await prisma.user.update({ where: { email: editorEmail }, data: { role: Role.EDITOR } });

    const freeRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'E2E Free', email: freeEmail, password });
    freeToken = freeRes.body.accessToken;
  });

  afterAll(async () => {
    await prisma.article.deleteMany({ where: { categoryId } });
    await prisma.category.delete({ where: { id: categoryId } });
    await prisma.user.deleteMany({ where: { email: { in: [editorEmail, freeEmail] } } });
    await app.close();
  });

  it('POST /articles avvises for en FREE-bruker med 403', async () => {
    await request(app.getHttpServer())
      .post('/articles')
      .set('Authorization', `Bearer ${freeToken}`)
      .send({
        title: 'Skal feile',
        excerpt: 'Ingress',
        content: 'Innhold',
        ageGroup: AgeGroup.ONE_TO_THREE,
        categoryId,
      })
      .expect(403);
  });

  it('POST /articles avvises helt uten JWT med 401', async () => {
    await request(app.getHttpServer())
      .post('/articles')
      .send({ title: 'X', excerpt: 'X', content: 'X', ageGroup: AgeGroup.ONE_TO_THREE, categoryId })
      .expect(401);
  });

  it('POST /articles med ukjent categoryId gir 400', async () => {
    await request(app.getHttpServer())
      .post('/articles')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({
        title: 'X',
        excerpt: 'X',
        content: 'X',
        ageGroup: AgeGroup.ONE_TO_THREE,
        categoryId: '00000000-0000-0000-0000-000000000000',
      })
      .expect(400);
  });

  it('EDITOR kan opprette en artikkel som kladd (uten publishedAt)', async () => {
    const res = await request(app.getHttpServer())
      .post('/articles')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({
        title: 'Kladd-artikkel',
        excerpt: 'Ingress',
        content: 'Hemmelig innhold, ikke publisert ennå',
        ageGroup: AgeGroup.ONE_TO_THREE,
        categoryId,
      })
      .expect(201);

    expect(res.body.publishedAt).toBeNull();
    draftArticleId = res.body.id;
  });

  it('GET /articles (gjest) viser ikke kladden', async () => {
    const res = await request(app.getHttpServer()).get(`/articles?categorySlug=${categorySlug}`).expect(200);

    expect(res.body.data.find((a: { id: string }) => a.id === draftArticleId)).toBeUndefined();
  });

  it('GET /articles/:id (gjest) på en kladd gir 404, ikke 403', async () => {
    await request(app.getHttpServer()).get(`/articles/${draftArticleId}`).expect(404);
  });

  it('GET /articles/:id (EDITOR) kan forhåndsvise kladden', async () => {
    await request(app.getHttpServer())
      .get(`/articles/${draftArticleId}`)
      .set('Authorization', `Bearer ${editorToken}`)
      .expect(200);
  });

  it('PATCH /articles/:id publiserer kladden', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/articles/${draftArticleId}`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ publishedAt: new Date(Date.now() - 1000).toISOString() })
      .expect(200);

    expect(res.body.publishedAt).not.toBeNull();
  });

  it('GET /articles (gjest) viser nå den publiserte artikkelen, med paginerings-metadata', async () => {
    const res = await request(app.getHttpServer()).get(`/articles?categorySlug=${categorySlug}`).expect(200);

    expect(res.body.data.some((a: { id: string }) => a.id === draftArticleId)).toBe(true);
    expect(res.body.meta).toEqual(
      expect.objectContaining({ page: 1, pageSize: 10, total: expect.any(Number), totalPages: expect.any(Number) }),
    );
  });

  it('GET /articles/:id øker visningstelleren for hvert kall', async () => {
    const first = await request(app.getHttpServer()).get(`/articles/${draftArticleId}`).expect(200);
    const second = await request(app.getHttpServer()).get(`/articles/${draftArticleId}`).expect(200);

    expect(second.body.views).toBe(first.body.views + 1);
  });

  it('GET /articles?pageSize=51 avvises med 400 (over det tillatte taket)', async () => {
    await request(app.getHttpServer()).get('/articles?pageSize=51').expect(400);
  });

  it('subscriberOnly-artikkel skjuler content for en FREE-bruker, men viser locked:true', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/articles')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({
        title: 'Låst artikkel',
        excerpt: 'Ingress',
        content: 'Kun for abonnenter',
        ageGroup: AgeGroup.ONE_TO_THREE,
        categoryId,
        subscriberOnly: true,
        publishedAt: new Date(Date.now() - 1000).toISOString(),
      })
      .expect(201);
    lockedArticleId = createRes.body.id;

    const guestRes = await request(app.getHttpServer()).get(`/articles/${lockedArticleId}`).expect(200);
    expect(guestRes.body.locked).toBe(true);
    expect(guestRes.body).not.toHaveProperty('content');

    const freeRes = await request(app.getHttpServer())
      .get(`/articles/${lockedArticleId}`)
      .set('Authorization', `Bearer ${freeToken}`)
      .expect(200);
    expect(freeRes.body.locked).toBe(true);
    expect(freeRes.body).not.toHaveProperty('content');
  });

  it('subscriberOnly-artikkel viser content når brukeren blir SUBSCRIBER', async () => {
    await prisma.user.update({ where: { email: freeEmail }, data: { role: Role.SUBSCRIBER } });

    // Samme JWT brukes fortsatt - JwtStrategy.validate() slår opp rollen på nytt fra DB for hvert
    // kall (se kommentaren i jwt.strategy.ts), så en rolleendring i databasen trer i kraft
    // umiddelbart uten at brukeren må logge inn på nytt.
    const res = await request(app.getHttpServer())
      .get(`/articles/${lockedArticleId}`)
      .set('Authorization', `Bearer ${freeToken}`)
      .expect(200);

    expect(res.body.locked).toBe(false);
    expect(res.body.content).toBe('Kun for abonnenter');

    await prisma.user.update({ where: { email: freeEmail }, data: { role: Role.FREE } });
  });

  it('DELETE /articles/:id avvises for FREE (403), fungerer for EDITOR (204)', async () => {
    await request(app.getHttpServer())
      .delete(`/articles/${lockedArticleId}`)
      .set('Authorization', `Bearer ${freeToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/articles/${lockedArticleId}`)
      .set('Authorization', `Bearer ${editorToken}`)
      .expect(204);

    await request(app.getHttpServer()).get(`/articles/${lockedArticleId}`).expect(404);
  });
});
