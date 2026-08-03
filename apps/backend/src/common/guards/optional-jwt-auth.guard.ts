import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Som JwtAuthGuard, men avviser ALDRI requesten hvis token mangler eller er ugyldig -
// den setter bare request.user hvis den klarer å identifisere brukeren, og lar requesten
// gå videre som "gjest" (user = undefined) ellers. Brukes på offentlige leseendepunkter
// (f.eks. GET /articles) der vi likevel trenger å vite OM noen er innlogget, for å
// avgjøre om de skal se innhold bak betalingsmuren.
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  // Overstyrer Passport sin default-oppførsel, som ellers kaster UnauthorizedException
  // når strategien ikke finner/validerer et token.
  handleRequest<TUser = unknown>(_err: unknown, user: TUser) {
    return user ?? undefined;
  }

  canActivate(context: ExecutionContext) {
    return super.canActivate(context) as Promise<boolean>;
  }
}
