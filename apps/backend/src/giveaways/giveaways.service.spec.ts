import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma, GiveawayStatus, Role } from '@prisma/client';
import { GiveawaysService } from './giveaways.service';
import { PrismaService } from '../prisma/prisma.service';
import { RandomnessService } from './randomness.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

// Unit-tester: PrismaService og RandomnessService er begge mocket - ingen ekte database, og
// vinnertrekningen er ikke egentlig tilfeldig i disse testene (RandomnessService.pickIndex mockes
// til en fast verdi), som er nettopp poenget med å pakke inn crypto.randomInt bak et eget
// injectable - se modul-forklaringen om hvorfor.
describe('GiveawaysService', () => {
  let service: GiveawaysService;
  let prisma: {
    giveaway: { findMany: jest.Mock; count: jest.Mock; findUnique: jest.Mock; create: jest.Mock; updateMany: jest.Mock; update: jest.Mock };
    giveawayEntry: { findUnique: jest.Mock; create: jest.Mock; findMany: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };
  let randomness: { pickIndex: jest.Mock };

  const winnerUser: AuthenticatedUser = { id: 'u1', name: 'Vinner', email: 'vinner@example.com', role: Role.FREE };
  const otherUser: AuthenticatedUser = { id: 'u2', name: 'Andre', email: 'andre@example.com', role: Role.FREE };

  const futureDeadline = new Date(Date.now() + 60_000).toISOString();
  const pastDeadline = new Date(Date.now() - 60_000);

  const uniqueConstraintError = () =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });

  beforeEach(async () => {
    prisma = {
      giveaway: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
      },
      giveawayEntry: { findUnique: jest.fn(), create: jest.fn(), findMany: jest.fn(), update: jest.fn() },
      $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
    };
    randomness = { pickIndex: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        GiveawaysService,
        { provide: PrismaService, useValue: prisma },
        { provide: RandomnessService, useValue: randomness },
      ],
    }).compile();

    service = moduleRef.get(GiveawaysService);
  });

  describe('create', () => {
    it('kaster BadRequestException hvis deadline er i fortiden', async () => {
      await expect(
        service.create({ title: 'T', prizeDescription: 'P', deadline: pastDeadline.toISOString() }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.giveaway.create).not.toHaveBeenCalled();
    });

    it('oppretter trekningen når deadline er i fremtiden', async () => {
      prisma.giveaway.create.mockResolvedValue({ id: 'g1' });

      await service.create({ title: 'T', prizeDescription: 'P', deadline: futureDeadline });

      expect(prisma.giveaway.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ title: 'T', prizeDescription: 'P' }) }),
      );
    });
  });

  describe('findOne', () => {
    it('kaster NotFoundException hvis trekningen ikke finnes', async () => {
      prisma.giveaway.findUnique.mockResolvedValue(null);

      await expect(service.findOne('mangler')).rejects.toThrow(NotFoundException);
    });

    it('setter hasEntered=true hvis brukeren allerede har en påmelding', async () => {
      prisma.giveaway.findUnique.mockResolvedValue({ id: 'g1', status: GiveawayStatus.OPEN });
      prisma.giveawayEntry.findUnique.mockResolvedValue({ id: 'entry-1' });

      const result = await service.findOne('g1', winnerUser);

      expect(result.hasEntered).toBe(true);
    });

    it('setter hasEntered=false for en gjest (ingen bruker)', async () => {
      prisma.giveaway.findUnique.mockResolvedValue({ id: 'g1', status: GiveawayStatus.OPEN });

      const result = await service.findOne('g1', undefined);

      expect(result.hasEntered).toBe(false);
      expect(prisma.giveawayEntry.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('enter', () => {
    it('kaster NotFoundException hvis trekningen ikke finnes', async () => {
      prisma.giveaway.findUnique.mockResolvedValue(null);

      await expect(service.enter('mangler', 'u1')).rejects.toThrow(NotFoundException);
    });

    it('kaster BadRequestException hvis trekningen ikke lenger er OPEN', async () => {
      prisma.giveaway.findUnique.mockResolvedValue({ status: GiveawayStatus.DRAWN, deadline: new Date(futureDeadline) });

      await expect(service.enter('g1', 'u1')).rejects.toThrow(BadRequestException);
    });

    it('kaster BadRequestException hvis deadline har passert', async () => {
      prisma.giveaway.findUnique.mockResolvedValue({ status: GiveawayStatus.OPEN, deadline: pastDeadline });

      await expect(service.enter('g1', 'u1')).rejects.toThrow(BadRequestException);
    });

    it('kaster ConflictException hvis brukeren allerede er påmeldt (unik constraint)', async () => {
      prisma.giveaway.findUnique.mockResolvedValue({ status: GiveawayStatus.OPEN, deadline: new Date(futureDeadline) });
      prisma.giveawayEntry.create.mockRejectedValue(uniqueConstraintError());

      await expect(service.enter('g1', 'u1')).rejects.toThrow(ConflictException);
    });

    it('oppretter påmeldingen når alt er gyldig', async () => {
      prisma.giveaway.findUnique.mockResolvedValue({ status: GiveawayStatus.OPEN, deadline: new Date(futureDeadline) });
      prisma.giveawayEntry.create.mockResolvedValue({ id: 'entry-1' });

      const result = await service.enter('g1', 'u1');

      expect(result).toEqual({ id: 'entry-1' });
    });
  });

  describe('submitShippingAddress', () => {
    it('kaster NotFoundException hvis trekningen ikke finnes', async () => {
      prisma.giveaway.findUnique.mockResolvedValue(null);

      await expect(
        service.submitShippingAddress('mangler', winnerUser, { shippingAddress: 'Storgata 1, 0155 Oslo' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('kaster ForbiddenException hvis brukeren ikke er vinneren', async () => {
      prisma.giveaway.findUnique.mockResolvedValue({ id: 'g1', winnerId: winnerUser.id });

      await expect(
        service.submitShippingAddress('g1', otherUser, { shippingAddress: 'Storgata 1, 0155 Oslo' }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.giveawayEntry.update).not.toHaveBeenCalled();
    });

    it('oppdaterer adressen når brukeren faktisk er vinneren', async () => {
      prisma.giveaway.findUnique.mockResolvedValue({ id: 'g1', winnerId: winnerUser.id });
      prisma.giveawayEntry.update.mockResolvedValue({ id: 'entry-1', shippingAddress: 'Storgata 1, 0155 Oslo' });

      await service.submitShippingAddress('g1', winnerUser, { shippingAddress: 'Storgata 1, 0155 Oslo' });

      expect(prisma.giveawayEntry.update).toHaveBeenCalledWith({
        where: { giveawayId_userId: { giveawayId: 'g1', userId: winnerUser.id } },
        data: { shippingAddress: 'Storgata 1, 0155 Oslo' },
      });
    });
  });

  describe('drawWinner', () => {
    it('gjør ingenting hvis trekningen allerede er trukket (claim.count === 0)', async () => {
      prisma.giveaway.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.drawWinner('g1');

      expect(result).toBeNull();
      expect(prisma.giveawayEntry.findMany).not.toHaveBeenCalled();
    });

    it('setter CANCELED hvis ingen har meldt seg på', async () => {
      prisma.giveaway.updateMany.mockResolvedValue({ count: 1 });
      prisma.giveawayEntry.findMany.mockResolvedValue([]);
      prisma.giveaway.update.mockResolvedValue({ id: 'g1', status: GiveawayStatus.CANCELED });

      await service.drawWinner('g1');

      expect(prisma.giveaway.update).toHaveBeenCalledWith({
        where: { id: 'g1' },
        data: { status: GiveawayStatus.CANCELED },
      });
    });

    it('bruker RandomnessService for å velge vinner blant påmeldte, ikke Math.random', async () => {
      prisma.giveaway.updateMany.mockResolvedValue({ count: 1 });
      prisma.giveawayEntry.findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }]);
      randomness.pickIndex.mockReturnValue(2);
      prisma.giveaway.update.mockResolvedValue({ id: 'g1', title: 'T', winner: { email: 'u3@example.com' } });

      await service.drawWinner('g1');

      expect(randomness.pickIndex).toHaveBeenCalledWith(3);
      expect(prisma.giveaway.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'g1' }, data: { winnerId: 'u3' } }),
      );
    });
  });

  describe('autoDrawExpiredGiveaways', () => {
    it('trekker vinner for hver OPEN trekning med utløpt deadline', async () => {
      prisma.giveaway.findMany.mockResolvedValue([{ id: 'g1' }, { id: 'g2' }]);
      const drawSpy = jest.spyOn(service, 'drawWinner').mockResolvedValue(null);

      await service.autoDrawExpiredGiveaways();

      expect(prisma.giveaway.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: GiveawayStatus.OPEN, deadline: { lte: expect.any(Date) } } }),
      );
      expect(drawSpy).toHaveBeenCalledWith('g1');
      expect(drawSpy).toHaveBeenCalledWith('g2');
    });
  });
});
