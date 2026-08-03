import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import Stripe from 'stripe';
import { Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// Integrasjonstest mot en ekte Nest-app + ekte Postgres (samme oppsett som auth/articles e2e-spec).
// Webhook-testene bruker Stripe SDK-ens EGEN generateTestHeaderString(...) for å signere test-events
// lokalt, med samme (falske, kun-for-lokal-testing) STRIPE_WEBHOOK_SECRET som står i apps/backend/.env -
// dette krever verken nettverkstilgang eller en ekte Stripe-konto, siden signaturen kun er en HMAC
// beregnet lokalt, akkurat slik Stripe selv ville gjort det server-side.
//
// POST /subscriptions/checkout derimot MÅ snakke med det ekte Stripe-API-et for å opprette en
// Checkout Session, og hoppes derfor over med en konsoll-advarsel med mindre STRIPE_SECRET_KEY og
// STRIPE_PRICE_ID i .env peker på en ekte Stripe test-mode-konto.
describe('Subscriptions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const signingStripe = new Stripe('sk_test_dummy_used_only_for_local_signature_generation');
  const webhookSecret = 'whsec_test_dummy_for_local_unit_and_e2e_tests';

  const runId = Date.now();
  const email = `e2e-sub-${runId}@example.com`;
  const password = 'supersecret123';
  const stripeSubscriptionId = `sub_e2e_${runId}`;

  let token: string;
  let userId: string;

  function postSignedWebhook(eventPayload: Record<string, unknown>) {
    const payload = JSON.stringify(eventPayload);
    const signature = signingStripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });

    return request(app.getHttpServer())
      .post('/subscriptions/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payload);
  }

  function subscriptionEvent(type: string, statusOverride = 'active') {
    const now = Math.floor(Date.now() / 1000);
    return {
      id: `evt_e2e_${runId}_${Math.random()}`,
      type,
      data: {
        object: {
          id: stripeSubscriptionId,
          status: statusOverride,
          customer: `cus_e2e_${runId}`,
          metadata: { userId },
          items: { data: [{ current_period_start: now, current_period_end: now + 2_592_000 }] },
        },
      },
    };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);

    const registerRes = await request(app.getHttpServer()).post('/auth/register').send({
      name: 'E2E Abonnent',
      email,
      password,
    });
    token = registerRes.body.accessToken;
    userId = registerRes.body.user.id;
  });

  afterAll(async () => {
    await prisma.subscription.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  it('POST /subscriptions/checkout avvises uten JWT (401)', async () => {
    await request(app.getHttpServer()).post('/subscriptions/checkout').expect(401);
  });

  it('GET /subscriptions/me avvises uten JWT (401)', async () => {
    await request(app.getHttpServer()).get('/subscriptions/me').expect(401);
  });

  it('GET /subscriptions/me viser INACTIVE for en bruker som aldri har abonnert', async () => {
    const res = await request(app.getHttpServer())
      .get('/subscriptions/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.status).toBe('INACTIVE');
  });

  it('POST /subscriptions/webhook avviser en ugyldig signatur med 400', async () => {
    await request(app.getHttpServer())
      .post('/subscriptions/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 't=1,v1=feil-signatur')
      .send(JSON.stringify({ id: 'evt_x', type: 'customer.subscription.updated', data: { object: {} } }))
      .expect(400);
  });

  it('customer.subscription.updated (active) aktiverer abonnementet og oppgraderer brukeren til SUBSCRIBER', async () => {
    await postSignedWebhook(subscriptionEvent('customer.subscription.updated', 'active')).expect(200);

    const subRes = await request(app.getHttpServer())
      .get('/subscriptions/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(subRes.body.status).toBe('ACTIVE');

    const meRes = await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(meRes.body.role).toBe(Role.SUBSCRIBER);
  });

  it('samme event levert på nytt (Stripe-retry) er idempotent: fortsatt 200, ingen feil', async () => {
    // Gjenbruker EKSAKT samme event som forrige test ville generert er upraktisk her (ny event-ID
    // hver gang) - så vi tester idempotens ved å sende det NØYAKTIG samme payload+signatur-parret to
    // ganger på rad, som er akkurat det Stripe sin retry-mekanisme faktisk gjør.
    const event = subscriptionEvent('customer.subscription.updated', 'active');
    await postSignedWebhook(event).expect(200);
    await postSignedWebhook(event).expect(200);
  });

  it('customer.subscription.deleted setter abonnementet til CANCELED og nedgraderer til FREE', async () => {
    await postSignedWebhook(subscriptionEvent('customer.subscription.deleted')).expect(200);

    const subRes = await request(app.getHttpServer())
      .get('/subscriptions/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(subRes.body.status).toBe('CANCELED');

    const meRes = await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(meRes.body.role).toBe(Role.FREE);
  });

  it('POST /subscriptions/checkout oppretter en ekte Stripe Checkout Session (kun hvis ekte test-nøkler er satt i .env)', async () => {
    const hasRealKey = !!process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_') && !!process.env.STRIPE_PRICE_ID;
    if (!hasRealKey) {
      // eslint-disable-next-line no-console
      console.warn(
        'Hopper over live Stripe-sjekk: sett STRIPE_SECRET_KEY (sk_test_...) og STRIPE_PRICE_ID i .env for å kjøre denne testen mot ekte Stripe test-mode.',
      );
      return;
    }

    const res = await request(app.getHttpServer())
      .post('/subscriptions/checkout')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    expect(res.body.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
  });
});
