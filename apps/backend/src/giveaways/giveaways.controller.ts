import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { GiveawaysService } from './giveaways.service';
import { CreateGiveawayDto } from './dto/create-giveaway.dto';
import { QueryGiveawaysDto } from './dto/query-giveaways.dto';
import { SubmitShippingAddressDto } from './dto/submit-shipping-address.dto';
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

@ApiTags('giveaways')
@Controller('giveaways')
export class GiveawaysController {
  constructor(private giveawaysService: GiveawaysService) {}

  @Get()
  @ApiOperation({ summary: 'List trekninger (offentlig, paginert)' })
  findAll(@Query() query: QueryGiveawaysDto) {
    return this.giveawaysService.findAll(query);
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Hent én trekning (offentlig, viser om du selv har meldt deg på)' })
  findOne(@Param('id') id: string, @CurrentUser() user?: AuthenticatedUser) {
    return this.giveawaysService.findOne(id, user);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Opprett en ny trekning (kun ADMIN)' })
  create(@Body() dto: CreateGiveawayDto) {
    return this.giveawaysService.create(dto);
  }

  @Post(':id/enter')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Meld deg på en trekning' })
  enter(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.giveawaysService.enter(id, user.id);
  }

  @Post(':id/draw')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Trekk vinner nå (kun ADMIN - skjer ellers automatisk via cron ved deadline)' })
  draw(@Param('id') id: string) {
    return this.giveawaysService.drawWinner(id);
  }

  @Patch(':id/winner/shipping-address')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Send inn leveringsadresse (kun vinneren av trekningen)' })
  submitShippingAddress(
    @Param('id') id: string,
    @Body() dto: SubmitShippingAddressDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.giveawaysService.submitShippingAddress(id, user, dto);
  }
}
