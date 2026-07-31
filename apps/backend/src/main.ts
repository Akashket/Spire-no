import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  // bufferLogs: true samler opp loggmeldinger fra oppstart-fasen og sender dem videre til pino
  // først etter at appen (og dermed pino-loggeren) er ferdig konstruert, slik at ingenting går tapt.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // Helmet setter en rekke sikre HTTP-headere by default (bl.a. hindrer clickjacking og
  // MIME-type sniffing) - billig å legge til, ingen god grunn til å la være.
  app.use(helmet());
  app.enableCors();

  // Global validering av ALLE innkommende request-bodies mot DTO-klassenes class-validator-regler.
  // - whitelist: fjerner felter som ikke finnes i DTO-en (hindrer f.eks. at noen sender "role": "ADMIN"
  //   i registrerings-requesten og håper det blir plukket opp av et for grådig databasekall).
  // - forbidNonWhitelisted: kaster en tydelig 400-feil i stedet for å stille droppe ukjente felter,
  //   som gjør feilsøking for API-konsumenten enklere.
  // - transform: konverterer JSON til faktiske DTO-instanser (og typer, f.eks. string -> number).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Spire.no API')
    .setDescription('API for Spire.no - redaksjonelt nettsted for foreldre')
    .setVersion('0.1')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
}

bootstrap();
