import { Injectable } from '@nestjs/common';
import { randomInt } from 'crypto';

// Wrapper rundt Node sin kryptografisk sikre randomInt (fra 'crypto', IKKE Math.random - se
// modul-forklaringen for hvorfor det skiller seg fra en vanlig pseudo-tilfeldig generator).
// Injectable av samme grunn som StripeService: en tynn wrapper rundt noe ikke-deterministisk lar
// tester injisere en forutsigbar mock i stedet for å teste ekte tilfeldighet - og unngår samtidig
// jest.spyOn-fellen vi støtte på med bcryptjs+esModuleInterop i auth-modulen, siden vi her aldri
// trenger å spy() på selve crypto-modulen.
@Injectable()
export class RandomnessService {
  pickIndex(exclusiveMax: number): number {
    return randomInt(0, exclusiveMax);
  }
}
