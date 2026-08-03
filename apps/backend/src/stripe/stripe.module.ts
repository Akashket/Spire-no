import { Global, Module } from '@nestjs/common';
import { StripeService } from './stripe.service';

// @Global(): Stripe-klienten er statsløs infrastruktur (som PrismaService) - ingen grunn til å
// re-importere StripeModule i hver eneste modul som trenger den.
@Global()
@Module({
  providers: [StripeService],
  exports: [StripeService],
})
export class StripeModule {}
