import { Injectable } from '@nestjs/common';
import { GiveawayStatus, Role, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  async getOverview() {
    const [
      totalUsers,
      freeUsers,
      subscriberUsers,
      editorUsers,
      adminUsers,
      totalArticles,
      publishedArticles,
      inactiveSubscriptions,
      activeSubscriptions,
      pastDueSubscriptions,
      canceledSubscriptions,
      openGiveaways,
      drawnGiveaways,
      canceledGiveaways,
      recentWinners,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { role: Role.FREE } }),
      this.prisma.user.count({ where: { role: Role.SUBSCRIBER } }),
      this.prisma.user.count({ where: { role: Role.EDITOR } }),
      this.prisma.user.count({ where: { role: Role.ADMIN } }),
      this.prisma.article.count(),
      this.prisma.article.count({ where: { publishedAt: { lte: new Date() } } }),
      this.prisma.subscription.count({ where: { status: SubscriptionStatus.INACTIVE } }),
      this.prisma.subscription.count({ where: { status: SubscriptionStatus.ACTIVE } }),
      this.prisma.subscription.count({ where: { status: SubscriptionStatus.PAST_DUE } }),
      this.prisma.subscription.count({ where: { status: SubscriptionStatus.CANCELED } }),
      this.prisma.giveaway.count({ where: { status: GiveawayStatus.OPEN } }),
      this.prisma.giveaway.count({ where: { status: GiveawayStatus.DRAWN } }),
      this.prisma.giveaway.count({ where: { status: GiveawayStatus.CANCELED } }),
      // Ordnet på deadline (ikke createdAt) - nærmeste proxy vi har for "sist avsluttet trekning",
      // siden skjemaet ikke lagrer et eget drawnAt-tidspunkt (ikke verdt en egen migrasjon for et
      // rent oversikts-endepunkt).
      this.prisma.giveaway.findMany({
        where: { status: GiveawayStatus.DRAWN, winnerId: { not: null } },
        orderBy: { deadline: 'desc' },
        take: 10,
        select: {
          id: true,
          title: true,
          deadline: true,
          winner: { select: { id: true, name: true, email: true } },
        },
      }),
    ]);

    return {
      users: {
        total: totalUsers,
        byRole: { FREE: freeUsers, SUBSCRIBER: subscriberUsers, EDITOR: editorUsers, ADMIN: adminUsers },
      },
      articles: {
        total: totalArticles,
        published: publishedArticles,
        drafts: totalArticles - publishedArticles,
      },
      subscriptions: {
        byStatus: {
          INACTIVE: inactiveSubscriptions,
          ACTIVE: activeSubscriptions,
          PAST_DUE: pastDueSubscriptions,
          CANCELED: canceledSubscriptions,
        },
      },
      giveaways: {
        byStatus: { OPEN: openGiveaways, DRAWN: drawnGiveaways, CANCELED: canceledGiveaways },
        recentWinners,
      },
    };
  }
}
