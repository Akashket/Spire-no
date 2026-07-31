import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Tynn wrapper rundt Passport sin innebygde AuthGuard, bundet til 'jwt'-strategien
// (registrert i auth/strategies/jwt.strategy.ts). All selve verifiseringslogikken
// (sjekke signatur, utløpsdato, slå opp bruker) ligger i strategien - guarden her
// trigger bare Passport-flyten og avviser requesten med 401 hvis den feiler.
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
