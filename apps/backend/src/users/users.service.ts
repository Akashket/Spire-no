import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  create(data: { name: string; email: string; passwordHash: string; role?: Role }) {
    // role settes bevisst IKKE fra klient-input noe sted som kaller denne metoden fra en
    // offentlig endepunkt (se AuthService.register) - default FREE kommer fra @default(FREE)
    // i Prisma-skjemaet med mindre den overstyres eksplisitt her fra betrodd server-side kode
    // (f.eks. en admin som oppretter en redaktør-bruker).
    return this.prisma.user.create({ data });
  }
}
