import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Søvn' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  // Slug brukes i URL-er og filter-query-parametere (f.eks. /articles?categorySlug=sovn) - derfor
  // kun små bokstaver, tall og bindestrek, ingen mellomrom eller spesialtegn som må URL-enkodes.
  @ApiProperty({ example: 'sovn' })
  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug kan kun inneholde små bokstaver, tall og bindestrek (f.eks. "sovn-og-hvile")',
  })
  @MaxLength(100)
  slug: string;
}
