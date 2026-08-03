import { Module } from '@nestjs/common';
import { ArticlesService } from './articles.service';
import { ArticlesController } from './articles.controller';

// Trenger ikke importere PassportModule her: 'jwt'-strategien (JwtStrategy) registreres på
// passport sin globale singleton når AuthModule instansierer den ved oppstart, og AuthGuard('jwt')
// (brukt av både JwtAuthGuard og OptionalJwtAuthGuard) slår opp strategien direkte via passport,
// ikke via Nest sin DI-container - derfor er den tilgjengelig i alle moduler uten re-import.
@Module({
  providers: [ArticlesService],
  controllers: [ArticlesController],
})
export class ArticlesModule {}
