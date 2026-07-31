import { INestApplication, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// Pakker PrismaClient inn som en vanlig Nest-injectable, slik at vi kan bruke Nests
// dependency injection (constructor(private prisma: PrismaService)) i stedet for å importere
// en global singleton-instans overalt - gjør det trivielt å bytte ut med en mock i tester.
//
// OnModuleInit/OnModuleDestroy kobler databasetilkoblingen til applikasjonens livssyklus:
// vi åpner ÉN connection pool når appen starter, og lukker den ryddig ved shutdown - i stedet for
// å åpne/lukke en tilkobling per request, som ville vært langt tregere og kunne tømt Postgres
// sin max_connections-grense under last.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  async enableShutdownHooks(app: INestApplication) {
    process.on('beforeExit', async () => {
      await app.close();
    });
  }
}
