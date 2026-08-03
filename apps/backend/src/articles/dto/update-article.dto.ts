import { ApiPropertyOptional } from '@nestjs/swagger';
import { AgeGroup } from '@prisma/client';
import { IsBoolean, IsEnum, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

// Skrevet ut manuelt i stedet for PartialType(CreateArticleDto) (@nestjs/mapped-types) - unngår en
// ekstra avhengighet for et prosjekt av denne størrelsen. Alle felter er de samme som i
// CreateArticleDto, bare valgfrie: en PATCH skal kunne oppdatere ett enkelt felt (f.eks. bare
// publishedAt for å publisere en kladd) uten å måtte sende hele artikkelen på nytt.
export class UpdateArticleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  excerpt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  content?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional({ enum: AgeGroup })
  @IsOptional()
  @IsEnum(AgeGroup)
  ageGroup?: AgeGroup;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  subscriberOnly?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ example: '2026-08-10T08:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  publishedAt?: string;
}
