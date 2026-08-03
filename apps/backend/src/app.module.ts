import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { CategoriesModule } from './categories/categories.module';
import { ArticlesModule } from './articles/articles.module';
import { StripeModule } from './stripe/stripe.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { GiveawaysModule } from './giveaways/giveaways.module';

@Module({
  imports: [
    // isGlobal: true -> ConfigService kan injiseres hvor som helst uten å importere ConfigModule
    // i hver eneste modul på nytt.
    ConfigModule.forRoot({ isGlobal: true }),

    LoggerModule.forRoot({
      pinoHttp: {
        // pino-pretty gir lesbare, fargede logglinjer lokalt. I produksjon vil vi derimot ha
        // rå JSON-linjer (raskere, og maskinlesbart for et evt. logg-aggregeringsverktøy),
        // derfor kobles pretty-printeren kun inn utenfor "production".
        transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        // Logg ALDRI Authorization-headeren (inneholder JWT-et rått) eller cookies.
        redact: ['req.headers.authorization', 'req.headers.cookie'],
      },
    }),

    // Global rate limit som standard-fallback for alle endepunkter (100 requests/minutt/IP).
    // Auth-endepunktene overstyrer denne med en strengere @Throttle(...) siden de er et mer
    // attraktivt mål for brute-force-forsøk enn f.eks. et åpent GET /articles-endepunkt.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),

    // Registrerer @Cron(...)-håndterte metoder (se GiveawaysService.autoDrawExpiredGiveaways) - uten
    // denne gjør @Cron-dekoratoren ingenting, den trenger ScheduleModule sin runtime for faktisk å
    // planlegge og trigge jobben.
    ScheduleModule.forRoot(),

    PrismaModule,
    UsersModule,
    AuthModule,
    CategoriesModule,
    ArticlesModule,
    StripeModule,
    SubscriptionsModule,
    GiveawaysModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
