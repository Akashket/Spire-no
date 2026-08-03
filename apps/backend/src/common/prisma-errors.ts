import { Prisma } from '@prisma/client';

// Delt mellom moduler som trenger å skille "noen andre kom først" (en unik constraint i databasen
// slo inn - forventet under race conditions, se f.eks. subscriptions.service.ts og
// giveaways.service.ts) fra en faktisk uventet feil.
export function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
