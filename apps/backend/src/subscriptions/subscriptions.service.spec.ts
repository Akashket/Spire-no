import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, Role, SubscriptionStatus } from '@prisma/client';
import type Stripe from 'stripe';
import { SubscriptionsService } from './subscriptions.service';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

// Unit-tester: både PrismaService og StripeService er mocket - ingen ekte database og ingen ekte
// kall til Stripe sitt API. $transaction er mocket til å bare kjøre callback-en direkte mot de
// samme mockede modellene (tx === prisma her), som er nok til å teste forretningslogikken isolert.
describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let prisma: {
    subscription: { findUnique: jest.Mock; upsert: jest.Mock; update: jest.Mock };
    user: { findUnique: jest.Mock; update: jest.Mock };
    processedStripeEvent: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let stripeClient: {
    checkout: { sessions: { create: jest.Mock } };
    webhooks: { constructEvent: jest.Mock };
  };

  const freeUser: AuthenticatedUser = { id: 'u1', name: 'Fri', email: 'fri@example.com', role: Role.FREE };

  const uniqueConstraintError = () =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });

  function fakeSubscriptionEvent(
    type: 'customer.subscription.created' | 'customer.subscription.updated' | 'customer.subscription.deleted',
    overrides: Partial<Stripe.Subscription> = {},
  ): Stripe.Event {
    const subscription = {
      id: 'sub_123',
      status: 'active',
      customer: 'cus_123',
      metadata: { userId: 'u1' },
      items: { data: [{ current_period_start: 1700000000, current_period_end: 1702592000 }] },
      ...overrides,
    } as unknown as Stripe.Subscription;

    return { id: `evt_${Math.random()}`, type, data: { object: subscription } } as unknown as Stripe.Event;
  }

  beforeEach(async () => {
    prisma = {
      subscription: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() },
      user: { findUnique: jest.fn(), update: jest.fn() },
      processedStripeEvent: { create: jest.fn() },
      $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
    };

    stripeClient = {
      checkout: { sessions: { create: jest.fn() } },
      webhooks: { constructEvent: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StripeService, useValue: { client: stripeClient } },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, fallback?: string) => ({ FRONTEND_URL: 'http://localhost:3000' })[key] ?? fallback,
            getOrThrow: (key: string) =>
              ({ STRIPE_PRICE_ID: 'price_123', STRIPE_WEBHOOK_SECRET: 'whsec_test' })[key] as string,
          },
        },
      ],
    }).compile();

    service = moduleRef.get(SubscriptionsService);
  });

  describe('createCheckoutSession', () => {
    it('kaster ConflictException hvis brukeren allerede har et aktivt abonnement', async () => {
      prisma.subscription.findUnique.mockResolvedValue({ status: SubscriptionStatus.ACTIVE });

      await expect(service.createCheckoutSession(freeUser)).rejects.toThrow(ConflictException);
      expect(stripeClient.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('setter client_reference_id og subscription_data.metadata.userId fra den innloggede brukeren', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null);
      stripeClient.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.stripe.com/xyz' });

      const result = await service.createCheckoutSession(freeUser);

      const callArgs = stripeClient.checkout.sessions.create.mock.calls[0][0];
      expect(callArgs.client_reference_id).toBe('u1');
      expect(callArgs.subscription_data.metadata.userId).toBe('u1');
      expect(result.url).toBe('https://checkout.stripe.com/xyz');
    });
  });

  describe('getMySubscription', () => {
    it('returnerer INACTIVE-status hvis brukeren aldri har abonnert', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null);

      const result = await service.getMySubscription('u1');

      expect(result).toEqual({ status: SubscriptionStatus.INACTIVE });
    });
  });

  describe('handleWebhookEvent', () => {
    it('kaster BadRequestException ved ugyldig signatur', async () => {
      stripeClient.webhooks.constructEvent.mockImplementation(() => {
        throw new Error('signaturfeil');
      });

      await expect(service.handleWebhookEvent(Buffer.from('{}'), 'ugyldig-sig')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('er idempotent: en allerede behandlet event-ID gir stille no-op, ikke feil', async () => {
      const event = fakeSubscriptionEvent('customer.subscription.updated');
      stripeClient.webhooks.constructEvent.mockReturnValue(event);
      prisma.processedStripeEvent.create.mockRejectedValue(uniqueConstraintError());

      await expect(service.handleWebhookEvent(Buffer.from('{}'), 'sig')).resolves.toBeUndefined();
      expect(prisma.subscription.upsert).not.toHaveBeenCalled();
    });

    it('customer.subscription.updated (active) oppretter/oppdaterer abonnementet og oppgraderer FREE -> SUBSCRIBER', async () => {
      const event = fakeSubscriptionEvent('customer.subscription.updated', { status: 'active' });
      stripeClient.webhooks.constructEvent.mockReturnValue(event);
      prisma.processedStripeEvent.create.mockResolvedValue({ id: event.id });
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', role: Role.FREE });

      await service.handleWebhookEvent(Buffer.from('{}'), 'sig');

      expect(prisma.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1' },
          create: expect.objectContaining({ status: SubscriptionStatus.ACTIVE, stripeSubscriptionId: 'sub_123' }),
        }),
      );
      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { role: Role.SUBSCRIBER } });
    });

    it('customer.subscription.updated (past_due) beholder SUBSCRIBER-tilgang (dunning-periode)', async () => {
      const event = fakeSubscriptionEvent('customer.subscription.updated', { status: 'past_due' });
      stripeClient.webhooks.constructEvent.mockReturnValue(event);
      prisma.processedStripeEvent.create.mockResolvedValue({ id: event.id });
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', role: Role.FREE });

      await service.handleWebhookEvent(Buffer.from('{}'), 'sig');

      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { role: Role.SUBSCRIBER } });
    });

    it('customer.subscription.deleted setter CANCELED og nedgraderer SUBSCRIBER -> FREE', async () => {
      const event = fakeSubscriptionEvent('customer.subscription.deleted');
      stripeClient.webhooks.constructEvent.mockReturnValue(event);
      prisma.processedStripeEvent.create.mockResolvedValue({ id: event.id });
      prisma.subscription.findUnique.mockResolvedValue({ id: 'sub-row-1', userId: 'u1' });
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', role: Role.SUBSCRIBER });

      await service.handleWebhookEvent(Buffer.from('{}'), 'sig');

      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-row-1' },
        data: { status: SubscriptionStatus.CANCELED },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { role: Role.FREE } });
    });

    it('rører ALDRI rollen til en EDITOR, selv om abonnementet kanselleres', async () => {
      const event = fakeSubscriptionEvent('customer.subscription.deleted');
      stripeClient.webhooks.constructEvent.mockReturnValue(event);
      prisma.processedStripeEvent.create.mockResolvedValue({ id: event.id });
      prisma.subscription.findUnique.mockResolvedValue({ id: 'sub-row-1', userId: 'u1' });
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', role: Role.EDITOR });

      await service.handleWebhookEvent(Buffer.from('{}'), 'sig');

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('ignorerer ukjente/uhåndterte event-typer uten å kaste feil', async () => {
      const event = { id: 'evt_ukjent', type: 'invoice.paid', data: { object: {} } } as unknown as Stripe.Event;
      stripeClient.webhooks.constructEvent.mockReturnValue(event);
      prisma.processedStripeEvent.create.mockResolvedValue({ id: event.id });

      await expect(service.handleWebhookEvent(Buffer.from('{}'), 'sig')).resolves.toBeUndefined();
      expect(prisma.subscription.upsert).not.toHaveBeenCalled();
    });
  });
});
