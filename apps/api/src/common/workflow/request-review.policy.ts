import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import type { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../../modules/auth/auth.types';
export function assertEmployeeReviewer(actor: AuthenticatedUser): void {
  if (![Role.STAFF, Role.ADMIN, Role.SUPER_ADMIN].some((role) => role === actor.role))
    throw new ForbiddenException('Only an authorized employee can review this request.');
}
export async function reviewTransaction<T>(
  database: PrismaService,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await database.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034')
        throw error;
      if (attempt >= 2)
        throw new ConflictException(
          'This request changed during review. Refresh its status before retrying.',
        );
    }
  }
}
