import { BadRequestException, ConflictException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role, SubscriptionStatus } from '@prisma/client';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

const ROLE_ELIGIBLE_FOR_SYNC: Role[] = [Role.FREE, Role.SUBSCRIBER];
const ACCESS_GRANTING_STATUSES: SubscriptionStatus[] = [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE];

// Oversetter Stripe sine (mange flere) abonnement-statuser til vår egen, forenklede enum.
// 'trialing' telles som ACTIVE (full tilgang i prøveperioden), 'past_due'/'unpaid' som PAST_DUE
// (beholder tilgang i Stripe sin "dunning"-periode mens de prøver betalingen på nytt),
// alt annet (inkl. Stripe sin "OtherString"-type for fremtidige statuser vi ikke kjenner ennå) som
// CANCELED/INACTIVE er tryggest å anta ingen tilgang.
function mapStripeStatus(status: string): SubscriptionStatus {
  switch (status) {
    case 'active':
    case 'trialing':
      return SubscriptionStatus.ACTIVE;
    case 'past_due':
    case 'unpaid':
      return SubscriptionStatus.PAST_DUE;
    case 'canceled':
    case 'incomplete_expired':
      return SubscriptionStatus.CANCELED;
    default:
      return SubscriptionStatus.INACTIVE;
  }
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

@Injectable()
export class SubscriptionsService {
  constructor(
    private prisma: PrismaService,
    private stripe: StripeService,
    private config: ConfigService,
  ) {}

  async createCheckoutSession(user: AuthenticatedUser) {
    const existing = await this.prisma.subscription.findUnique({ where: { userId: user.id } });
    if (existing?.status === SubscriptionStatus.ACTIVE) {
      throw new ConflictException('Du har allerede et aktivt abonnement');
    }

    const frontendUrl = this.config.get<string>('FRONTEND_URL', 'http://localhost:3000');
    const priceId = this.config.getOrThrow<string>('STRIPE_PRICE_ID');

    const session = await this.stripe.client.checkout.sessions.create({
      mode: 'subscription',
      customer_email: user.email,
      client_reference_id: user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      // Metadata satt her dukker opp igjen på selve Subscription-objektet i Stripe, og dermed på
      // customer.subscription.*-webhook-eventene senere - det er SLIK vi kobler et innkommende
      // event tilbake til riktig bruker hos oss, uten et ekstra API-kall til Stripe for å slå det opp.
      subscription_data: { metadata: { userId: user.id } },
      success_url: `${frontendUrl}/abonnement/suksess?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/abonnement/avbrutt`,
    });

    if (!session.url) {
      throw new InternalServerErrorException('Stripe returnerte ingen checkout-URL');
    }

    return { url: session.url };
  }

  async getMySubscription(userId: string) {
    const subscription = await this.prisma.subscription.findUnique({ where: { userId } });
    return subscription ?? { status: SubscriptionStatus.INACTIVE };
  }

  async handleWebhookEvent(rawBody: Buffer, signature: string) {
    const webhookSecret = this.config.getOrThrow<string>('STRIPE_WEBHOOK_SECRET');

    let event: Stripe.Event;
    try {
      event = this.stripe.client.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch {
      // Signaturen matcher ikke - enten feil webhook-secret, eller (i verste fall) en forfalsket
      // request som later som den kommer fra Stripe. 400 gir Stripe beskjed om at NOE er galt uten
      // å lekke detaljer om hvorfor.
      throw new BadRequestException('Ugyldig Stripe-signatur');
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        // "Krever" event-ID-en FØRST, som en del av samme transaksjon som selve forretningslogikken -
        // se modul-forklaringen for hvorfor dette (ikke sjekk-så-behandle) er det som faktisk gjør
        // behandlingen idempotent under samtidige/dupliserte leveranser fra Stripe.
        await tx.processedStripeEvent.create({ data: { id: event.id } });
        await this.processEvent(event, tx);
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        return; // allerede behandlet - idempotent no-op, svar likevel 200 til Stripe
      }
      throw error;
    }
  }

  private async processEvent(event: Stripe.Event, tx: Prisma.TransactionClient) {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await this.upsertSubscriptionFromStripe(event.data.object, tx);
        break;
      case 'customer.subscription.deleted':
        await this.markSubscriptionCanceled(event.data.object, tx);
        break;
      default:
        // Andre event-typer (f.eks. checkout.session.completed, invoice.paid) ignoreres bevisst:
        // customer.subscription.created/updated bærer allerede alt vi trenger (status, periode,
        // kunde-ID) direkte i selve event-payloaden, satt via subscription_data.metadata ved
        // opprettelse - ingen grunn til å lytte på flere eventer for samme informasjon.
        break;
    }
  }

  private async upsertSubscriptionFromStripe(subscription: Stripe.Subscription, tx: Prisma.TransactionClient) {
    const userId = subscription.metadata.userId;
    if (!userId) {
      // Skjer kun for abonnement som ikke ble opprettet via vår egen checkout-flyt (f.eks. opprettet
      // manuelt i Stripe Dashboard for testing) - ingenting å koble det til hos oss.
      return;
    }

    const status = mapStripeStatus(subscription.status);
    // current_period_start/end flyttet fra selve Subscription-objektet til hvert enkelt
    // subscription-item i nyere Stripe API-versjoner (et abonnement kan i prinsippet ha flere
    // priser med ulike perioder) - vi bruker alltid første (og eneste) item, siden hver bruker her
    // kun har ett abonnement på én pris.
    const item = subscription.items.data[0];
    const currentPeriodStart = new Date(item.current_period_start * 1000);
    const currentPeriodEnd = new Date(item.current_period_end * 1000);
    const stripeCustomerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

    await tx.subscription.upsert({
      where: { userId },
      create: { userId, stripeCustomerId, stripeSubscriptionId: subscription.id, status, currentPeriodStart, currentPeriodEnd },
      update: { stripeCustomerId, stripeSubscriptionId: subscription.id, status, currentPeriodStart, currentPeriodEnd },
    });

    await this.syncUserRole(userId, status, tx);
  }

  private async markSubscriptionCanceled(subscription: Stripe.Subscription, tx: Prisma.TransactionClient) {
    const existing = await tx.subscription.findUnique({ where: { stripeSubscriptionId: subscription.id } });
    if (!existing) {
      return;
    }

    await tx.subscription.update({ where: { id: existing.id }, data: { status: SubscriptionStatus.CANCELED } });
    await this.syncUserRole(existing.userId, SubscriptionStatus.CANCELED, tx);
  }

  // Oppdaterer FREE <-> SUBSCRIBER basert på betalingsstatus - ALDRI EDITOR/ADMIN, som er
  // redaksjonelle roller uavhengig av om personen selv betaler for et abonnement.
  private async syncUserRole(userId: string, status: SubscriptionStatus, tx: Prisma.TransactionClient) {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || !ROLE_ELIGIBLE_FOR_SYNC.includes(user.role)) {
      return;
    }

    const targetRole = ACCESS_GRANTING_STATUSES.includes(status) ? Role.SUBSCRIBER : Role.FREE;
    if (user.role !== targetRole) {
      await tx.user.update({ where: { id: userId }, data: { role: targetRole } });
    }
  }
}
