import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// @Global() gjør PrismaService tilgjengelig i alle andre moduler uten at de trenger å
// importere PrismaModule eksplisitt hver gang. Dette er et bevisst unntak fra Nests vanlige
// "importer det du trenger"-mønster: nesten hver eneste modul i appen trenger databasetilgang,
// så å kreve eksplisitt import overalt hadde vært ren boilerplate uten reell fordel.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
