import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../../users/users.service';

interface JwtPayload {
  sub: string; // "subject" - standard JWT-claim for bruker-ID
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService, private usersService: UsersService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  // Kalles automatisk av Passport ETTER at token-signaturen og utløpsdatoen er verifisert kryptografisk.
  // Vi slår likevel opp brukeren i databasen på nytt her, i stedet for å stole blindt på dataene i
  // JWT-payloaden. Grunnen: et access-token er gyldig i opptil 15 minutter (se JWT_ACCESS_EXPIRES_IN) -
  // uten dette oppslaget ville en bruker som blir slettet, banned, eller får rollen sin nedgradert av
  // en admin, fortsatt hatt gyldig tilgang med det gamle token-et helt til det utløper av seg selv.
  async validate(payload: JwtPayload) {
    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException();
    }

    // Fjerner passwordHash før objektet havner på request.user - det skal aldri kunne lekke ut
    // via f.eks. en @CurrentUser()-respons eller en logglinje ved et uhell.
    const { passwordHash: _passwordHash, ...safeUser } = user;
    return safeUser;
  }
}
