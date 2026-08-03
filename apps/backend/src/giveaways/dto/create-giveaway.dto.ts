import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateGiveawayDto {
  @ApiProperty({ example: 'Vinn et gavekort på 1000 kr' })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title: string;

  @ApiProperty({ example: 'Et gavekort til Barnas Hus verdt 1000 kr' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  prizeDescription: string;

  // Valideres som "må være i fremtiden" i GiveawaysService, ikke her - class-validator har ingen
  // innebygd "etter nå"-regel, og en egen custom-decorator for én enkelt bruksstad er ikke verdt
  // kompleksiteten.
  @ApiProperty({ example: '2026-09-01T12:00:00.000Z' })
  @IsISO8601()
  deadline: string;
}
