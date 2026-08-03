import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateArticleDto } from './dto/create-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';
import { ArticleSort, QueryArticlesDto } from './dto/query-articles.dto';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

const EDITORIAL_ROLES: Role[] = [Role.EDITOR, Role.ADMIN];
const FULL_ACCESS_ROLES: Role[] = [Role.SUBSCRIBER, Role.EDITOR, Role.ADMIN];

@Injectable()
export class ArticlesService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: QueryArticlesDto, user?: AuthenticatedUser) {
    const isEditorial = !!user && EDITORIAL_ROLES.includes(user.role);
    const showDrafts = !!query.includeDrafts && isEditorial;

    const where = {
      ...(query.categorySlug ? { category: { slug: query.categorySlug } } : {}),
      ...(query.ageGroup ? { ageGroup: query.ageGroup } : {}),
      // Uten showDrafts: kun artikler som faktisk er publisert OG hvis publiseringstidspunkt har
      // passert - forhindrer at en fremtidig, planlagt artikkel lekker ut før den skal vises.
      ...(showDrafts ? {} : { publishedAt: { lte: new Date() } }),
    };

    const orderBy = query.sort === ArticleSort.POPULAR ? { views: 'desc' as const } : { publishedAt: 'desc' as const };

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;

    const [articles, total] = await Promise.all([
      this.prisma.article.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { category: true },
      }),
      this.prisma.article.count({ where }),
    ]);

    return {
      data: articles.map((article) => this.applyPaywall(article, user)),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async findOne(id: string, user?: AuthenticatedUser) {
    const article = await this.prisma.article.findUnique({ where: { id }, include: { category: true } });
    if (!article) {
      throw new NotFoundException('Fant ikke artikkelen');
    }

    const isEditorial = !!user && EDITORIAL_ROLES.includes(user.role);
    const isPublished = !!article.publishedAt && article.publishedAt <= new Date();
    if (!isPublished && !isEditorial) {
      // Behandler en kladd som om den ikke finnes for alle utenom redaksjonen, i stedet for 403 -
      // et 403 ville bekreftet at ID-en faktisk peker på en (upublisert) artikkel.
      throw new NotFoundException('Fant ikke artikkelen');
    }

    // Atomisk increment (databasen legger til 1, ikke applikasjonen) - se forklaring i
    // modul-gjennomgangen om hvorfor read-modify-write i kode ville tapt oppdateringer under samtidige
    // requests. Kladder som redaktører forhåndsviser teller ikke som lesninger.
    const updated = isPublished
      ? await this.prisma.article.update({
          where: { id },
          data: { views: { increment: 1 } },
          include: { category: true },
        })
      : article;

    return this.applyPaywall(updated, user);
  }

  async create(dto: CreateArticleDto, authorId: string) {
    await this.assertCategoryExists(dto.categoryId);

    return this.prisma.article.create({
      data: {
        title: dto.title,
        excerpt: dto.excerpt,
        content: dto.content,
        imageUrl: dto.imageUrl,
        ageGroup: dto.ageGroup,
        subscriberOnly: dto.subscriberOnly ?? false,
        categoryId: dto.categoryId,
        authorId,
        publishedAt: dto.publishedAt ? new Date(dto.publishedAt) : null,
      },
      include: { category: true },
    });
  }

  async update(id: string, dto: UpdateArticleDto, requestingUser: AuthenticatedUser) {
    const article = await this.prisma.article.findUnique({ where: { id } });
    if (!article) {
      throw new NotFoundException('Fant ikke artikkelen');
    }

    // EDITOR kan redigere alle artikler (ikke bare egne) - konsistent med at brevet sier
    // "EDITOR kan opprette/redigere artikler" uten å skille mellom egne og andres. ADMIN har uansett
    // full tilgang. Denne sjekken er derfor i praksis et no-op i dag, men gjør intensjonen eksplisitt
    // og er stedet å stramme inn hvis "kun egne artikler" blir et krav senere.
    if (!EDITORIAL_ROLES.includes(requestingUser.role)) {
      throw new ForbiddenException('Du har ikke tilgang til å redigere artikler');
    }

    if (dto.categoryId) {
      await this.assertCategoryExists(dto.categoryId);
    }

    return this.prisma.article.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.excerpt !== undefined ? { excerpt: dto.excerpt } : {}),
        ...(dto.content !== undefined ? { content: dto.content } : {}),
        ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl } : {}),
        ...(dto.ageGroup !== undefined ? { ageGroup: dto.ageGroup } : {}),
        ...(dto.subscriberOnly !== undefined ? { subscriberOnly: dto.subscriberOnly } : {}),
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
        ...(dto.publishedAt !== undefined ? { publishedAt: new Date(dto.publishedAt) } : {}),
      },
      include: { category: true },
    });
  }

  async remove(id: string) {
    const article = await this.prisma.article.findUnique({ where: { id } });
    if (!article) {
      throw new NotFoundException('Fant ikke artikkelen');
    }

    await this.prisma.article.delete({ where: { id } });
  }

  private async assertCategoryExists(categoryId: string) {
    const category = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) {
      throw new BadRequestException('Ukjent categoryId');
    }
  }

  // Fjerner "content" fra svaret når artikkelen er subscriberOnly og brukeren verken abonnerer
  // eller er redaksjonell - tittel/ingress/metadata blir værende, slik at artikkelen fortsatt kan
  // oppdages og markedsføres, men selve brødteksten er låst. Se modul-gjennomgangen for hvorfor
  // dette er bedre enn å 403-blokkere hele endepunktet.
  private applyPaywall<T extends { subscriberOnly: boolean; content: string }>(
    article: T,
    user?: AuthenticatedUser,
  ): Omit<T, 'content'> & { content?: string; locked: boolean } {
    const hasFullAccess = !article.subscriberOnly || (!!user && FULL_ACCESS_ROLES.includes(user.role));
    if (hasFullAccess) {
      return { ...article, locked: false };
    }

    const { content: _content, ...rest } = article;
    return { ...rest, locked: true };
  }
}
