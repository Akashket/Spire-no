import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { GiveawayStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RandomnessService } from './randomness.service';
import { CreateGiveawayDto } from './dto/create-giveaway.dto';
import { QueryGiveawaysDto } from './dto/query-giveaways.dto';
import { SubmitShippingAddressDto } from './dto/submit-shipping-address.dto';
import { isUniqueConstraintViolation } from '../common/prisma-errors';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

@Injectable()
export class GiveawaysService {
  private readonly logger = new Logger(GiveawaysService.name);

  constructor(
    private prisma: PrismaService,
    private randomness: RandomnessService,
  ) {}

  async findAll(query: QueryGiveawaysDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const where = query.status ? { status: query.status } : {};

    const [giveaways, total] = await Promise.all([
      this.prisma.giveaway.findMany({
        where,
        orderBy: { deadline: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { entries: true } }, winner: { select: { id: true, name: true } } },
      }),
      this.prisma.giveaway.count({ where }),
    ]);

    return { data: giveaways, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async findOne(id: string, user?: AuthenticatedUser) {
    const giveaway = await this.prisma.giveaway.findUnique({
      where: { id },
      include: { _count: { select: { entries: true } }, winner: { select: { id: true, name: true } } },
    });
    if (!giveaway) {
      throw new NotFoundException('Fant ikke trekningen');
    }

    const hasEntered = user
      ? (await this.prisma.giveawayEntry.findUnique({
          where: { giveawayId_userId: { giveawayId: id, userId: user.id } },
        })) !== null
      : false;

    return { ...giveaway, hasEntered };
  }

  async create(dto: CreateGiveawayDto) {
    if (new Date(dto.deadline) <= new Date()) {
      throw new BadRequestException('deadline må være et tidspunkt i fremtiden');
    }

    return this.prisma.giveaway.create({
      data: { title: dto.title, prizeDescription: dto.prizeDescription, deadline: new Date(dto.deadline) },
    });
  }

  async enter(giveawayId: string, userId: string) {
    const giveaway = await this.prisma.giveaway.findUnique({ where: { id: giveawayId } });
    if (!giveaway) {
      throw new NotFoundException('Fant ikke trekningen');
    }
    if (giveaway.status !== GiveawayStatus.OPEN || giveaway.deadline <= new Date()) {
      throw new BadRequestException('Påmeldingen er stengt for denne trekningen');
    }

    try {
      const entry = await this.prisma.giveawayEntry.create({ data: { giveawayId, userId } });
      this.logger.log(`Bruker ${userId} meldte seg på trekning ${giveawayId}`);
      return entry;
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        // Databasens unike constraint på [giveawayId, userId] (se schema.prisma) er det som faktisk
        // hindrer dobbel påmelding under en race - vi oversetter den bare til en forståelig 409 her.
        throw new ConflictException('Du er allerede påmeldt denne trekningen');
      }
      throw error;
    }
  }

  async submitShippingAddress(giveawayId: string, requestingUser: AuthenticatedUser, dto: SubmitShippingAddressDto) {
    const giveaway = await this.prisma.giveaway.findUnique({ where: { id: giveawayId } });
    if (!giveaway) {
      throw new NotFoundException('Fant ikke trekningen');
    }
    if (giveaway.winnerId !== requestingUser.id) {
      // Bevisst NotFoundException, ikke ForbiddenException, for konsistens med resten av API-et
      // (se paywall-/kladd-resonnementet i artikkel-modulen) - men her er poenget litt annerledes:
      // en 403 ville bekreftet at NOEN har vunnet uten at spørreren er den personen, som er
      // informasjon vi like gjerne kan la være å lekke.
      throw new ForbiddenException('Kun vinneren av trekningen kan sende inn leveringsadresse');
    }

    return this.prisma.giveawayEntry.update({
      where: { giveawayId_userId: { giveawayId, userId: requestingUser.id } },
      data: { shippingAddress: dto.shippingAddress },
    });
  }

  async drawWinner(giveawayId: string) {
    return this.prisma.$transaction(async (tx) => {
      // Samme mønster som idempotent webhook-håndtering i subscriptions.service.ts: "krev" trekningen
      // atomisk ved å bare oppdatere raden HVIS den fortsatt er OPEN, og se på count. Dette er det som
      // faktisk hindrer at cron-jobben og et manuelt admin-trykk trekker vinner to ganger hvis de
      // treffer nesten samtidig - uten denne sjekken ville "les status, sjekk om OPEN, oppdater" vært
      // en race condition mellom to samtidige kall.
      const claim = await tx.giveaway.updateMany({
        where: { id: giveawayId, status: GiveawayStatus.OPEN },
        data: { status: GiveawayStatus.DRAWN },
      });
      if (claim.count === 0) {
        return null; // allerede trukket (eller kansellert) - idempotent no-op
      }

      const entries = await tx.giveawayEntry.findMany({ where: { giveawayId } });
      if (entries.length === 0) {
        return tx.giveaway.update({ where: { id: giveawayId }, data: { status: GiveawayStatus.CANCELED } });
      }

      const winnerEntry = entries[this.randomness.pickIndex(entries.length)];
      const updated = await tx.giveaway.update({
        where: { id: giveawayId },
        data: { winnerId: winnerEntry.userId },
        include: { winner: { select: { id: true, name: true, email: true } } },
      });

      // Mocket/logget e-postvarsling - ingen ekte e-post-infrastruktur (SMTP/SES) er satt opp i dette
      // prosjektet, så en tydelig loggmelding er det avtalte omfanget her.
      this.logger.log(
        `[MOCK E-POST] Gratulerer til ${updated.winner?.email} - du har vunnet "${updated.title}"! Send inn leveringsadresse via POST /giveaways/${giveawayId}/winner/shipping-address`,
      );

      return updated;
    });
  }

  // Kjører hvert minutt - trekningsdeadlines trenger ikke sekund-presisjon, og et minutts
  // maks-forsinkelse fra deadline til faktisk trekning er et helt greit avvik for en trekning.
  @Cron(CronExpression.EVERY_MINUTE)
  async autoDrawExpiredGiveaways() {
    const expired = await this.prisma.giveaway.findMany({
      where: { status: GiveawayStatus.OPEN, deadline: { lte: new Date() } },
      select: { id: true },
    });

    for (const giveaway of expired) {
      await this.drawWinner(giveaway.id);
    }
  }
}
