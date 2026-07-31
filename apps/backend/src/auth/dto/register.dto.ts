import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'Kari Nordmann' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'kari@example.com' })
  @IsEmail()
  email: string;

  // Minstekrav på 8 tegn, ingen påtvunget "must contain uppercase/digit/symbol"-regel.
  // Dette følger NIST SP 800-63B sine anbefalinger: lengde er den sterkeste enkeltfaktoren for
  // passordstyrke, mens tvungne kompleksitetsregler ofte bare fører til forutsigbare mønstre
  // som "Passord1!" - en falsk trygghet som også gjør passord vanskeligere å huske.
  @ApiProperty({ example: 'minst-8-tegn', minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(72) // bcrypt trunkerer alt over 72 bytes - lengre passord ville stille blitt kuttet uten varsel
  password: string;
}
