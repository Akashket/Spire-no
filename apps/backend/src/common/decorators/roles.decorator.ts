import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';

// Brukes sammen med RolesGuard: @Roles(Role.EDITOR, Role.ADMIN) på en controller-metode.
// SetMetadata fester metadata på route-handleren som RolesGuard senere leser av via Reflector -
// dette er hvordan Nest lar deg gjøre deklarativ, "attributt-basert" tilgangsstyring i stedet for
// if-sjekker spredt i hver enkelt handler.
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
