import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';

export type CoverageStatus = 'AVAILABLE' | 'PLANNED' | 'UNAVAILABLE';

@Injectable()
export class CoverageService {
  constructor(private readonly prisma: PrismaService) {}

  async lookup(postcode: string) {
    const status = this.statusFor(Number(postcode));
    const plans =
      status === 'AVAILABLE'
        ? await this.prisma.internetPlan.findMany({
            where: { isActive: true },
            select: {
              id: true,
              name: true,
              downloadMbps: true,
              uploadMbps: true,
              monthlyCents: true,
            },
            orderBy: { monthlyCents: 'asc' },
          })
        : [];

    return {
      postcode,
      status,
      plans,
      message: this.messageFor(status),
      qualificationRequired: status === 'AVAILABLE',
    };
  }

  statusFor(postcode: number): CoverageStatus {
    if (
      (postcode >= 2000 && postcode <= 2234) ||
      (postcode >= 2555 && postcode <= 2574) ||
      (postcode >= 2745 && postcode <= 2770)
    ) {
      return 'AVAILABLE';
    }
    if ((postcode >= 2235 && postcode <= 2250) || (postcode >= 2560 && postcode <= 2580)) {
      return 'PLANNED';
    }
    return 'UNAVAILABLE';
  }

  private messageFor(status: CoverageStatus): string {
    if (status === 'AVAILABLE') {
      return 'Mero Telecom services this postcode. A final address qualification is required.';
    }
    if (status === 'PLANNED') {
      return 'This postcode is in the planned expansion area. Service is not yet orderable.';
    }
    return 'Mero Telecom does not currently service this postcode.';
  }
}
