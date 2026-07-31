import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

// Strengere rate limit enn API-ets globale default (100/min, satt i app.module.ts):
// 5 forsøk per minutt per IP. Auth-endepunkter er et yndet mål for brute-force- og
// credential-stuffing-angrep (automatiserte forsøk med lekkede passordlister), og bør derfor
// begrenses hardere enn f.eks. et offentlig GET /articles-endepunkt.
const AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  @Throttle(AUTH_THROTTLE)
  @ApiOperation({ summary: 'Registrer en ny bruker (får rollen FREE)' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK) // POST er default 201 Created i Nest - login oppretter ingen ressurs, så 200 er riktigere
  @Throttle(AUTH_THROTTLE)
  @ApiOperation({ summary: 'Logg inn og motta et JWT access-token' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Hent den innloggede brukerens egne data' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }
}
