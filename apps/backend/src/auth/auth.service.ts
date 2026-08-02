import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

// 12 salt-runder er en vanlig, veldokumentert avveining mellom sikkerhet og responstid i 2026 -
// hver økning på 1 dobler beregningstiden. 12 tar typisk 100-300ms på moderne maskinvare, som er
// merkbart nok til å gjøre brute-force upraktisk, men umerkelig for en ekte bruker som logger inn.
const SALT_ROUNDS = 12;

// Brukes KUN til å utjevne responstid i login() når brukeren ikke finnes (se der for forklaring) -
// dette er ikke en ekte konto sitt passord.
const DUMMY_HASH = bcrypt.hashSync('timing-attack-mitigation', SALT_ROUNDS);

interface SafeUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

@Injectable()
export class AuthService {
  constructor(private usersService: UsersService, private jwtService: JwtService) {}

  async register(dto: RegisterDto) {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('E-postadressen er allerede i bruk');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = await this.usersService.create({
      name: dto.name,
      email: dto.email,
      passwordHash,
    });

    return this.buildAuthResponse(user);
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);

    // Sikkerhetsdetalj: vi kaller bcrypt.compare uansett om brukeren finnes eller ikke (mot en
    // dummy-hash når den ikke gjør det). bcrypt.compare er den klart tregeste operasjonen i denne
    // funksjonen (~100-300ms), så uten dette ville "ukjent e-post" svart merkbart raskere enn
    // "kjent e-post, feil passord" - en tidsforskjell en angriper kan måle for å kartlegge hvilke
    // e-postadresser som faktisk er registrert (brukerenumerering), selv uten å noensinne se en
    // annen feilmelding.
    const passwordHash = user?.passwordHash ?? DUMMY_HASH;
    const passwordMatches = await bcrypt.compare(dto.password, passwordHash);

    if (!user || !passwordMatches) {
      // Bevisst identisk feilmelding for "finnes ikke" og "feil passord" - av samme grunn som over.
      throw new UnauthorizedException('Feil e-post eller passord');
    }

    return this.buildAuthResponse(user);
  }

  private async buildAuthResponse(user: SafeUser) {
    const payload = { sub: user.id, role: user.role };
    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    };
  }
}
