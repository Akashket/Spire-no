import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from '@prisma/client';

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

// Parameter-decorator som lar en controller-metode skrive @CurrentUser() user: AuthenticatedUser
// i stedet for å grave i @Req() request.user manuelt hver gang. Verdien er allerede satt av
// JwtStrategy.validate() (se auth/strategies/jwt.strategy.ts), som kjøres av JwtAuthGuard.
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});
