import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { AgeGroup } from '@prisma/client';

export enum ArticleSort {
  LATEST = 'latest',
  POPULAR = 'popular',
}

export class QueryArticlesDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number) // query-parametere kommer alltid inn som strenger - @Type konverterer før validering
  @IsInt()
  @Min(1)
  page?: number = 1;

  // Øvre tak på 50 hindrer en klient i å be om f.eks. pageSize=1000000 og tvinge databasen til å
  // hente/serialisere en enorm mengde rader i ett kall - en enkel, utilsiktet DoS-vektor.
  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number = 10;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categorySlug?: string;

  @ApiPropertyOptional({ enum: AgeGroup })
  @IsOptional()
  @IsEnum(AgeGroup)
  ageGroup?: AgeGroup;

  @ApiPropertyOptional({ enum: ArticleSort, default: ArticleSort.LATEST })
  @IsOptional()
  @IsIn(Object.values(ArticleSort))
  sort?: ArticleSort = ArticleSort.LATEST;

  // Kun EDITOR/ADMIN kan faktisk se kladder selv om dette settes til true - håndheves i
  // ArticlesService, ikke her (DTO-en vet ikke hvem brukeren er).
  @ApiPropertyOptional({ default: false, description: 'Inkluder upubliserte kladder (krever EDITOR/ADMIN)' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeDrafts?: boolean = false;
}
