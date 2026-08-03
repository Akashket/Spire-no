import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AgeGroup } from '@prisma/client';
import { IsBoolean, IsEnum, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateArticleDto {
  @ApiProperty({ example: 'Slik får du babyen til å sove hele natten' })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title: string;

  @ApiProperty({ example: 'Fem konkrete tips fra helsesøstre og søvnforskere.' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  excerpt: string;

  @ApiProperty({ example: '<p>Brødtekst i artikkelen...</p>' })
  @IsString()
  @MinLength(1)
  content: string;

  @ApiPropertyOptional({ example: 'https://cdn.spire.no/images/babysoevn.jpg' })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiProperty({ enum: AgeGroup, example: AgeGroup.ONE_TO_THREE })
  @IsEnum(AgeGroup)
  ageGroup: AgeGroup;

  @ApiPropertyOptional({ default: false, description: 'Krever aktivt abonnement for å lese hele artikkelen' })
  @IsOptional()
  @IsBoolean()
  subscriberOnly?: boolean;

  @ApiProperty({ description: 'ID-en til en eksisterende kategori (se GET /categories)' })
  @IsUUID()
  categoryId: string;

  // Valgfri - satt = artikkelen publiseres umiddelbart (eller til et fremtidig tidspunkt for
  // planlagt publisering). Utelatt = artikkelen lagres som kladd (publishedAt = null).
  @ApiPropertyOptional({ example: '2026-08-10T08:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  publishedAt?: string;
}
