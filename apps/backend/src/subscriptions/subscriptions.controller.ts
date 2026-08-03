import { BadRequestException, Controller, Get, Headers, HttpCode, HttpStatus, Post, RawBodyRequest, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { SubscriptionsService } from './subscriptions.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

@ApiTags('subscriptions')
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private subscriptionsService: SubscriptionsService) {}

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Opprett en Stripe Checkout Session for abonnement' })
  createCheckout(@CurrentUser() user: AuthenticatedUser) {
    return this.subscriptionsService.createCheckoutSession(user);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Hent egen abonnementsstatus' })
  getMine(@CurrentUser() user: AuthenticatedUser) {
    return this.subscriptionsService.getMySubscription(user.id);
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint() // Kalles kun av Stripe - ikke en del av det offentlige API-et for klienter
  handleWebhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature: string) {
    if (!req.rawBody) {
      // Skjer kun ved feil oppsett (rawBody: true mangler i main.ts sitt NestFactory.create-kall) -
      // uten den rå bufferen er det umulig å verifisere Stripe sin signatur korrekt.
      throw new BadRequestException('Mangler raw body på requesten');
    }

    return this.subscriptionsService.handleWebhookEvent(req.rawBody, signature);
  }
}
