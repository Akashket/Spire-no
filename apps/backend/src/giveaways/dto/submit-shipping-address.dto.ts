import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class SubmitShippingAddressDto {
  @ApiProperty({ example: 'Storgata 1, 0155 Oslo' })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  shippingAddress: string;
}
