import { Test } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';

// Unit-test: PrismaService er mocket - verifiserer at overview-objektet er satt sammen riktig
// fra de underliggende (mockede) tellingene, ikke selve databaselogikken (den er triviell count()).
describe('AdminService', () => {
  let service: AdminService;
  let prisma: {
    user: { count: jest.Mock };
    article: { count: jest.Mock };
    subscription: { count: jest.Mock };
    giveaway: { count: jest.Mock; findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      user: { count: jest.fn() },
      article: { count: jest.fn() },
      subscription: { count: jest.fn() },
      giveaway: { count: jest.fn(), findMany: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [AdminService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(AdminService);
  });

  it('setter sammen brukere, artikler, abonnement og trekninger til ett oversikts-objekt', async () => {
    // user.count kalles 5 ganger (total, FREE, SUBSCRIBER, EDITOR, ADMIN) i den rekkefølgen -
    // mockReturnValueOnce-kjeden matcher rekkefølgen i AdminService.getOverview().
    prisma.user.count
      .mockResolvedValueOnce(10) // total
      .mockResolvedValueOnce(6) // FREE
      .mockResolvedValueOnce(2) // SUBSCRIBER
      .mockResolvedValueOnce(1) // EDITOR
      .mockResolvedValueOnce(1); // ADMIN
    prisma.article.count
      .mockResolvedValueOnce(20) // total
      .mockResolvedValueOnce(15); // published
    prisma.subscription.count
      .mockResolvedValueOnce(3) // INACTIVE
      .mockResolvedValueOnce(2) // ACTIVE
      .mockResolvedValueOnce(1) // PAST_DUE
      .mockResolvedValueOnce(4); // CANCELED
    prisma.giveaway.count
      .mockResolvedValueOnce(2) // OPEN
      .mockResolvedValueOnce(5) // DRAWN
      .mockResolvedValueOnce(1); // CANCELED
    prisma.giveaway.findMany.mockResolvedValue([
      { id: 'g1', title: 'T', deadline: new Date(), winner: { id: 'u1', name: 'Kari', email: 'kari@example.com' } },
    ]);

    const result = await service.getOverview();

    expect(result).toEqual({
      users: { total: 10, byRole: { FREE: 6, SUBSCRIBER: 2, EDITOR: 1, ADMIN: 1 } },
      articles: { total: 20, published: 15, drafts: 5 },
      subscriptions: { byStatus: { INACTIVE: 3, ACTIVE: 2, PAST_DUE: 1, CANCELED: 4 } },
      giveaways: {
        byStatus: { OPEN: 2, DRAWN: 5, CANCELED: 1 },
        recentWinners: [
          { id: 'g1', title: 'T', deadline: expect.any(Date), winner: { id: 'u1', name: 'Kari', email: 'kari@example.com' } },
        ],
      },
    });
  });
});
