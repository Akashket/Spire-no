import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// Integrasjonstest: bygger en ekte Nest-applikasjon (samme moduler, guards og pipes som i main.ts)
// og sender ekte HTTP-requests mot den med supertest. Dette krever en faktisk Postgres-database
// tilgjengelig via DATABASE_URL (miljøvariabelen leses fra apps/backend/.env av ConfigModule).
//
// Kjør infrastrukturen først: `npm run infra:up` fra rotmappen, deretter `npm run test:backend:e2e`.
describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  // Unik e-post per testkjøring - unngår kollisjon med data fra en tidligere kjøring som ikke
  // ble ryddet opp (f.eks. hvis afterAll aldri rakk å kjøre).
  const testEmail = `e2e-auth-${Date.now()}@example.com`;
  const testPassword = 'supersecret123';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    // Samme globale pipe som i main.ts - uten denne ville testene ikke reflektere
    // hvordan API-et faktisk oppfører seg for en ekte klient.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: testEmail } });
    await app.close();
  });

  it('POST /auth/register oppretter en bruker med rolle FREE og returnerer et access-token', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'E2E Test', email: testEmail, password: testPassword })
      .expect(201);

    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user.email).toBe(testEmail);
    expect(res.body.user.role).toBe('FREE');
    expect(res.body.user).not.toHaveProperty('passwordHash');
  });

  it('POST /auth/register avviser duplikat e-post med 409 Conflict', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'E2E Test To', email: testEmail, password: testPassword })
      .expect(409);
  });

  it('POST /auth/register avviser for kort passord med 400 (class-validator)', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'E2E Test', email: `short-${testEmail}`, password: '123' })
      .expect(400);
  });

  it('POST /auth/register ignorerer/avviser felter som ikke finnes i DTO-en, f.eks. forsøk på å sette rolle selv', async () => {
    // forbidNonWhitelisted: true -> ukjente felter gir 400, ikke stille sletting.
    // Dette beviser at en klient IKKE kan sende "role": "ADMIN" og få det godtatt.
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'E2E Test', email: `role-${testEmail}`, password: testPassword, role: 'ADMIN' })
      .expect(400);
  });

  it('POST /auth/login gir 401 ved feil passord', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: testEmail, password: 'feil-passord' })
      .expect(401);
  });

  it('POST /auth/login gir 401 for en e-post som ikke finnes', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'finnes-ikke@example.com', password: testPassword })
      .expect(401);
  });

  it('GET /auth/me krever gyldig JWT (401 uten)', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('GET /auth/me returnerer brukerdata med et gyldig token fra login', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: testEmail, password: testPassword })
      .expect(200);

    const meRes = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
      .expect(200);

    expect(meRes.body.email).toBe(testEmail);
  });
});
