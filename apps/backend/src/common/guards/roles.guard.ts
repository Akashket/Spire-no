import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';

// VIKTIG: denne guarden må stå ETTER JwtAuthGuard i @UseGuards(...)-listen, f.eks.
// @UseGuards(JwtAuthGuard, RolesGuard) - guards kjører i rekkefølge, og RolesGuard er avhengig av
// at request.user allerede er satt av JwtAuthGuard/JwtStrategy.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // getAllAndOverride sjekker både metode- og klasse-nivå metadata, slik at man kan sette
    // @Roles(...) enten på hele controlleren eller på enkeltmetoder.
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Ingen @Roles(...) satt -> routen er åpen for alle innloggede brukere (autentisering
    // håndteres separat av JwtAuthGuard). Rollesjekk er opt-in, ikke opt-out.
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user) {
      throw new ForbiddenException('Krever innlogging');
    }

    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException('Du har ikke tilgang til denne ressursen');
    }

    return true;
  }
}
