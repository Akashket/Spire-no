import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// Integrasjonstest mot en ekte Nest-app + ekte Postgres (samme oppsett som de andre e2e-suitene).
// Merk: ScheduleModule sin ekte cron-jobb (EVERY_MINUTE) kjører også i denne test-app-instansen.
// Det er bevisst ikke et problem - drawWinner() er idempotent (se giveaways.service.ts), så selv om
// cron-jobben skulle trekke en av testenes trekninger før et manuelt /draw-kall rekker det, blir
// sluttresultatet identisk. Giveaway-en med flere påmeldte får uansett en deadline langt fram i tid
// slik at den ikke i utgangspunktet plukkes opp av cron i løpet av testkjøringen.
describe('Giveaways (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const runId = Date.now();
  const adminEmail = `e2e-admin-${runId}@example.com`;
  const free1Email = `e2e-free1-${runId}@example.com`;
  const free2Email = `e2e-free2-${runId}@example.com`;
  const password = 'supersecret123';

  let adminToken: string;
  let free1Token: string;
  let free2Token: string;
  let free1Id: string;
  let free2Id: string;
  let giveawayId: string;

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

    const free1Res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'E2E Fri 1', email: free1Email, password });
    free1Token = free1Res.body.accessToken;
    free1Id = free1Res.body.user.id;

    const free2Res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'E2E Fri 2', email: free2Email, password });
    free2Token = free2Res.body.accessToken;
    free2Id = free2Res.body.user.id;
  });

  afterAll(async () => {
    await prisma.giveawayEntry.deleteMany({ where: { userId: { in: [free1Id, free2Id] } } });
    await prisma.giveaway.deleteMany({ where: { title: { startsWith: `E2E Trekning ${runId}` } } });
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, free1Email, free2Email] } } });
    await app.close();
  });

  it('POST /giveaways avvises for en FREE-bruker (403) og uten JWT (401)', async () => {
    await request(app.getHttpServer())
      .post('/giveaways')
      .set('Authorization', `Bearer ${free1Token}`)
      .send({ title: 'X', prizeDescription: 'X', deadline: new Date(Date.now() + 60_000).toISOString() })
      .expect(403);

    await request(app.getHttpServer())
      .post('/giveaways')
      .send({ title: 'X', prizeDescription: 'X', deadline: new Date(Date.now() + 60_000).toISOString() })
      .expect(401);
  });

  it('POST /giveaways avviser en deadline i fortiden med 400', async () => {
    await request(app.getHttpServer())
      .post('/giveaways')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'X', prizeDescription: 'X', deadline: new Date(Date.now() - 60_000).toISOString() })
      .expect(400);
  });

  it('ADMIN oppretter en trekning med gyldig fremtidig deadline', async () => {
    const res = await request(app.getHttpServer())
      .post('/giveaways')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: `E2E Trekning ${runId}`,
        prizeDescription: 'Et gavekort',
        deadline: new Date(Date.now() + 5 * 60_000).toISOString(),
      })
      .expect(201);

    giveawayId = res.body.id;
    expect(res.body.status).toBe('OPEN');
  });

  it('GET /giveaways/:id viser hasEntered=false før påmelding', async () => {
    const res = await request(app.getHttpServer())
      .get(`/giveaways/${giveawayId}`)
      .set('Authorization', `Bearer ${free1Token}`)
      .expect(200);

    expect(res.body.hasEntered).toBe(false);
    expect(res.body._count.entries).toBe(0);
  });

  it('POST /giveaways/:id/enter krever JWT (401)', async () => {
    await request(app.getHttpServer()).post(`/giveaways/${giveawayId}/enter`).expect(401);
  });

  it('to ulike brukere kan melde seg på, men samme bruker kan ikke melde seg på to ganger (409)', async () => {
    await request(app.getHttpServer())
      .post(`/giveaways/${giveawayId}/enter`)
      .set('Authorization', `Bearer ${free1Token}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/giveaways/${giveawayId}/enter`)
      .set('Authorization', `Bearer ${free1Token}`)
      .expect(409);

    await request(app.getHttpServer())
      .post(`/giveaways/${giveawayId}/enter`)
      .set('Authorization', `Bearer ${free2Token}`)
      .expect(201);
  });

  it('GET /giveaways/:id viser hasEntered=true etter påmelding', async () => {
    const res = await request(app.getHttpServer())
      .get(`/giveaways/${giveawayId}`)
      .set('Authorization', `Bearer ${free1Token}`)
      .expect(200);

    expect(res.body.hasEntered).toBe(true);
    expect(res.body._count.entries).toBe(2);
  });

  it('POST /giveaways/:id/draw avvises for en FREE-bruker (403)', async () => {
    await request(app.getHttpServer())
      .post(`/giveaways/${giveawayId}/draw`)
      .set('Authorization', `Bearer ${free1Token}`)
      .expect(403);
  });

  it('ADMIN trekker en vinner blant de to påmeldte, og et andre trekk er et idempotent no-op', async () => {
    const drawRes = await request(app.getHttpServer())
      .post(`/giveaways/${giveawayId}/draw`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    expect([free1Id, free2Id]).toContain(drawRes.body.winnerId);

    // Trekker en gang til - skal IKKE trekke en ny/annen vinner eller kaste feil.
    await request(app.getHttpServer())
      .post(`/giveaways/${giveawayId}/draw`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    const giveaway = await prisma.giveaway.findUnique({ where: { id: giveawayId } });
    expect(giveaway?.status).toBe('DRAWN');
  });

  it('kun vinneren kan sende inn leveringsadresse - taperen får 403, vinneren får 200', async () => {
    const giveaway = await prisma.giveaway.findUnique({ where: { id: giveawayId } });
    const winnerToken = giveaway?.winnerId === free1Id ? free1Token : free2Token;
    const loserToken = giveaway?.winnerId === free1Id ? free2Token : free1Token;

    await request(app.getHttpServer())
      .patch(`/giveaways/${giveawayId}/winner/shipping-address`)
      .set('Authorization', `Bearer ${loserToken}`)
      .send({ shippingAddress: 'Storgata 1, 0155 Oslo' })
      .expect(403);

    const res = await request(app.getHttpServer())
      .patch(`/giveaways/${giveawayId}/winner/shipping-address`)
      .set('Authorization', `Bearer ${winnerToken}`)
      .send({ shippingAddress: 'Storgata 1, 0155 Oslo' })
      .expect(200);

    expect(res.body.shippingAddress).toBe('Storgata 1, 0155 Oslo');
  });

  it('en trekning uten noen påmeldte blir CANCELED i stedet for DRAWN', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/giveaways')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: `E2E Trekning ${runId} (ingen påmeldte)`,
        prizeDescription: 'Et gavekort',
        deadline: new Date(Date.now() + 1_000).toISOString(),
      })
      .expect(201);

    const drawRes = await request(app.getHttpServer())
      .post(`/giveaways/${createRes.body.id}/draw`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    expect(drawRes.body.status).toBe('CANCELED');
    expect(drawRes.body.winnerId).toBeNull();
  });
});
