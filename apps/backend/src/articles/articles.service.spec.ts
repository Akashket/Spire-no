import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AgeGroup, Role } from '@prisma/client';
import { ArticlesService } from './articles.service';
import { PrismaService } from '../prisma/prisma.service';
import { ArticleSort } from './dto/query-articles.dto';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

// Unit-tester: PrismaService er mocket, så disse treffer aldri en ekte database - de tester
// forretningslogikken i ArticlesService isolert (paywall-regler, synlighet av kladder,
// atomisk visningsteller kalt riktig).
describe('ArticlesService', () => {
  let service: ArticlesService;
  let prisma: {
    article: {
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      create: jest.Mock;
      delete: jest.Mock;
    };
    category: { findUnique: jest.Mock };
  };

  const freeUser: AuthenticatedUser = { id: 'u1', name: 'Free', email: 'free@example.com', role: Role.FREE };
  const subscriberUser: AuthenticatedUser = {
    id: 'u2',
    name: 'Sub',
    email: 'sub@example.com',
    role: Role.SUBSCRIBER,
  };
  const editorUser: AuthenticatedUser = { id: 'u3', name: 'Ed', email: 'ed@example.com', role: Role.EDITOR };

  const baseArticle = {
    id: 'a1',
    title: 'Tittel',
    excerpt: 'Ingress',
    content: 'Hele brødteksten',
    imageUrl: null,
    ageGroup: AgeGroup.ONE_TO_THREE,
    subscriberOnly: false,
    publishedAt: new Date('2020-01-01T00:00:00.000Z'),
    views: 5,
    categoryId: 'c1',
    authorId: 'u3',
    category: { id: 'c1', name: 'Søvn', slug: 'sovn' },
  };

  beforeEach(async () => {
    prisma = {
      article: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
      category: { findUnique: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [ArticlesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(ArticlesService);
  });

  describe('findAll', () => {
    it('viser kun publiserte artikler for en gjest (ingen bruker)', async () => {
      prisma.article.findMany.mockResolvedValue([]);
      prisma.article.count.mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 10, sort: ArticleSort.LATEST, includeDrafts: true }, undefined);

      const whereArg = prisma.article.findMany.mock.calls[0][0].where;
      expect(whereArg.publishedAt).toEqual({ lte: expect.any(Date) });
    });

    it('lar en EDITOR se kladder når includeDrafts=true', async () => {
      prisma.article.findMany.mockResolvedValue([]);
      prisma.article.count.mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 10, sort: ArticleSort.LATEST, includeDrafts: true }, editorUser);

      const whereArg = prisma.article.findMany.mock.calls[0][0].where;
      expect(whereArg.publishedAt).toBeUndefined();
    });

    it('ignorerer includeDrafts for en FREE-bruker (ikke redaksjonell)', async () => {
      prisma.article.findMany.mockResolvedValue([]);
      prisma.article.count.mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 10, sort: ArticleSort.LATEST, includeDrafts: true }, freeUser);

      const whereArg = prisma.article.findMany.mock.calls[0][0].where;
      expect(whereArg.publishedAt).toEqual({ lte: expect.any(Date) });
    });
  });

  describe('findOne', () => {
    it('kaster NotFoundException hvis artikkelen ikke finnes', async () => {
      prisma.article.findUnique.mockResolvedValue(null);

      await expect(service.findOne('mangler')).rejects.toThrow(NotFoundException);
    });

    it('skjuler en upublisert kladd for en vanlig bruker som 404 (ikke 403)', async () => {
      prisma.article.findUnique.mockResolvedValue({ ...baseArticle, publishedAt: null });

      await expect(service.findOne('a1', freeUser)).rejects.toThrow(NotFoundException);
      expect(prisma.article.update).not.toHaveBeenCalled();
    });

    it('lar en EDITOR forhåndsvise en kladd, men teller det ikke som en visning', async () => {
      prisma.article.findUnique.mockResolvedValue({ ...baseArticle, publishedAt: null });

      const result = await service.findOne('a1', editorUser);

      expect(result.title).toBe(baseArticle.title);
      expect(prisma.article.update).not.toHaveBeenCalled();
    });

    it('øker visningstelleren atomisk (increment) for en publisert artikkel', async () => {
      prisma.article.findUnique.mockResolvedValue(baseArticle);
      prisma.article.update.mockResolvedValue({ ...baseArticle, views: 6 });

      await service.findOne('a1', freeUser);

      expect(prisma.article.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { views: { increment: 1 } },
        include: { category: true },
      });
    });

    it('fjerner content fra svaret for en subscriberOnly-artikkel når brukeren er FREE', async () => {
      prisma.article.findUnique.mockResolvedValue({ ...baseArticle, subscriberOnly: true });
      prisma.article.update.mockResolvedValue({ ...baseArticle, subscriberOnly: true, views: 6 });

      const result = await service.findOne('a1', freeUser);

      expect(result.locked).toBe(true);
      expect(result).not.toHaveProperty('content');
    });

    it('viser content for en subscriberOnly-artikkel når brukeren er SUBSCRIBER', async () => {
      prisma.article.findUnique.mockResolvedValue({ ...baseArticle, subscriberOnly: true });
      prisma.article.update.mockResolvedValue({ ...baseArticle, subscriberOnly: true, views: 6 });

      const result = await service.findOne('a1', subscriberUser);

      expect(result.locked).toBe(false);
      expect(result.content).toBe(baseArticle.content);
    });

    it('fjerner content for en subscriberOnly-artikkel når ingen er innlogget (gjest)', async () => {
      prisma.article.findUnique.mockResolvedValue({ ...baseArticle, subscriberOnly: true });
      prisma.article.update.mockResolvedValue({ ...baseArticle, subscriberOnly: true, views: 6 });

      const result = await service.findOne('a1', undefined);

      expect(result.locked).toBe(true);
      expect(result).not.toHaveProperty('content');
    });
  });

  describe('create', () => {
    it('kaster BadRequestException hvis categoryId ikke finnes', async () => {
      prisma.category.findUnique.mockResolvedValue(null);

      await expect(
        service.create(
          {
            title: 'T',
            excerpt: 'E',
            content: 'C',
            ageGroup: AgeGroup.ONE_TO_THREE,
            categoryId: 'finnes-ikke',
          },
          'u3',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.article.create).not.toHaveBeenCalled();
    });

    it('setter authorId fra parameteren, ikke fra DTO-en, og publishedAt=null uten dato', async () => {
      prisma.category.findUnique.mockResolvedValue({ id: 'c1', name: 'Søvn', slug: 'sovn' });
      prisma.article.create.mockResolvedValue(baseArticle);

      await service.create(
        { title: 'T', excerpt: 'E', content: 'C', ageGroup: AgeGroup.ONE_TO_THREE, categoryId: 'c1' },
        'u3',
      );

      const createArgs = prisma.article.create.mock.calls[0][0];
      expect(createArgs.data.authorId).toBe('u3');
      expect(createArgs.data.publishedAt).toBeNull();
    });
  });

  describe('remove', () => {
    it('kaster NotFoundException hvis artikkelen ikke finnes', async () => {
      prisma.article.findUnique.mockResolvedValue(null);

      await expect(service.remove('mangler')).rejects.toThrow(NotFoundException);
      expect(prisma.article.delete).not.toHaveBeenCalled();
    });
  });
});
