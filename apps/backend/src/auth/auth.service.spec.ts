import { Test } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

// Unit-tester: UsersService og JwtService er mocket, så disse testene treffer ALDRI en ekte database.
// Det gjør dem raske (millisekunder, ikke sekunder) og lar oss teste forretningslogikken
// (hashing, feilhåndtering, timing-mitigering) isolert fra infrastruktur.
describe('AuthService', () => {
  let authService: AuthService;
  let usersService: { findByEmail: jest.Mock; create: jest.Mock };

  beforeEach(async () => {
    usersService = { findByEmail: jest.fn(), create: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        {
          provide: JwtService,
          useValue: { signAsync: jest.fn().mockResolvedValue('fake.jwt.token') },
        },
      ],
    }).compile();

    authService = moduleRef.get(AuthService);
  });

  describe('register', () => {
    it('hasher passordet (lagrer aldri klartekst) og returnerer et access-token', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockImplementation(async (data) => ({
        id: 'user-1',
        role: 'FREE',
        ...data,
      }));

      const result = await authService.register({
        name: 'Kari Nordmann',
        email: 'kari@example.com',
        password: 'supersecret123',
      });

      expect(usersService.create).toHaveBeenCalledTimes(1);
      const createdArgs = usersService.create.mock.calls[0][0];

      expect(createdArgs.passwordHash).not.toBe('supersecret123');
      expect(await bcrypt.compare('supersecret123', createdArgs.passwordHash)).toBe(true);

      expect(result.accessToken).toBe('fake.jwt.token');
      expect(result.user).toEqual({
        id: 'user-1',
        name: 'Kari Nordmann',
        email: 'kari@example.com',
        role: 'FREE',
      });
      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('kaster ConflictException hvis e-posten allerede er i bruk, og oppretter ingen ny bruker', async () => {
      usersService.findByEmail.mockResolvedValue({ id: 'existing-user' });

      await expect(
        authService.register({ name: 'Kari', email: 'kari@example.com', password: 'supersecret123' }),
      ).rejects.toThrow(ConflictException);

      expect(usersService.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('returnerer et access-token når passordet stemmer', async () => {
      const passwordHash = await bcrypt.hash('supersecret123', 4); // lav cost i tester = raskere
      usersService.findByEmail.mockResolvedValue({
        id: 'user-1',
        name: 'Kari Nordmann',
        email: 'kari@example.com',
        role: 'FREE',
        passwordHash,
      });

      const result = await authService.login({ email: 'kari@example.com', password: 'supersecret123' });

      expect(result.accessToken).toBe('fake.jwt.token');
    });

    it('kaster UnauthorizedException ved feil passord', async () => {
      const passwordHash = await bcrypt.hash('supersecret123', 4);
      usersService.findByEmail.mockResolvedValue({ id: 'user-1', role: 'FREE', passwordHash });

      await expect(
        authService.login({ email: 'kari@example.com', password: 'feil-passord' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('kaster UnauthorizedException når brukeren ikke finnes, uten å avsløre det i feilmeldingen', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        authService.login({ email: 'finnes-ikke@example.com', password: 'whatever123' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('kaller bcrypt.compare selv når brukeren ikke finnes (timing-attack-mitigering)', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      const compareSpy = jest.spyOn(bcrypt, 'compare');

      await expect(authService.login({ email: 'ukjent@example.com', password: 'noe' })).rejects.toThrow();

      // Uten dette kallet ville "ukjent bruker"-responsen returnert merkbart raskere enn
      // "kjent bruker, feil passord" - se kommentaren i auth.service.ts for hvorfor det er et problem.
      expect(compareSpy).toHaveBeenCalled();
      compareSpy.mockRestore();
    });
  });
});
