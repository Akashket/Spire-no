import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

// Tynn wrapper rundt Stripe-SDK-en, injectable som alt annet i Nest. Uten denne ville hver service
// som trenger Stripe måtte konstruere sin egen `new Stripe(...)`-instans (dyrt å gjenta, og umulig
// å mocke rent i tester uten et slikt indirection-lag).
@Injectable()
export class StripeService {
  readonly client: Stripe;

  constructor(config: ConfigService) {
    // apiVersion utelates bevisst - SDK-en (v22) bruker sin egen bundlede standardversjon
    // ("2026-07-29.dahlia" i skrivende stund). Å pinne en annen versjon i kode krever at den
    // matcher en versjon SDK-en faktisk støtter typene for, og gir liten gevinst i et prosjekt
    // som alltid bruker nyeste SDK - relevant å vurdere på nytt hvis appen noensinne fryses på en
    // eldre stripe-pakke mens Stripe sin API fortsetter å utvikle seg.
    this.client = new Stripe(config.getOrThrow<string>('STRIPE_SECRET_KEY'));
  }
}
