import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Admin (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const runId = Date.now();
  const adminEmail = `e2e-admin-overview-${runId}@example.com`;
  const freeEmail = `e2e-free-overview-${runId}@example.com`;
  const password = 'supersecret123';

  let adminToken: string;
  let freeToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);

    const adminRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'E2E Admin', email: adminEmail, password });
    adminToken = adminRes.body.accessToken;
    await prisma.user.update({ where: { email: adminEmail }, data: { role: Role.ADMIN } });

    const freeRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'E2E Fri', email: freeEmail, password });
    freeToken = freeRes.body.accessToken;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, freeEmail] } } });
    await app.close();
  });

  it('GET /admin/overview krever JWT (401)', async () => {
    await request(app.getHttpServer()).get('/admin/overview').expect(401);
  });

  it('GET /admin/overview avvises for en FREE-bruker (403)', async () => {
    await request(app.getHttpServer()).get('/admin/overview').set('Authorization', `Bearer ${freeToken}`).expect(403);
  });

  it('GET /admin/overview returnerer et konsolidert dashboard for ADMIN', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/overview')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        users: expect.objectContaining({
          total: expect.any(Number),
          byRole: expect.objectContaining({ FREE: expect.any(Number), ADMIN: expect.any(Number) }),
        }),
        articles: expect.objectContaining({ total: expect.any(Number), published: expect.any(Number), drafts: expect.any(Number) }),
        subscriptions: expect.objectContaining({ byStatus: expect.any(Object) }),
        giveaways: expect.objectContaining({ byStatus: expect.any(Object), recentWinners: expect.any(Array) }),
      }),
    );
    // Vi opprettet nettopp minst 2 brukere (admin + free) i denne testen, så tellingen må reflektere det.
    expect(res.body.users.total).toBeGreaterThanOrEqual(2);
    expect(res.body.users.byRole.ADMIN).toBeGreaterThanOrEqual(1);
  });
});
