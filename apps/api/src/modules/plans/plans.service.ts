import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AdminDashboardCacheService } from '../cache/admin-dashboard-cache.service';
import { CreatePlanDto, UpdatePlanDto } from './dto/plan.dto';

@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboardCache: AdminDashboardCacheService,
  ) {}
  async create(input: CreatePlanDto) {
    const plan = await this.prisma.internetPlan.create({ data: input }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('A plan with this name already exists.');
      throw error;
    });
    await this.dashboardCache.invalidate();
    return plan;
  }
  findActive() {
    return this.prisma.internetPlan.findMany({
      where: { isActive: true },
      orderBy: { monthlyCents: 'asc' },
    });
  }
  findAll() {
    return this.prisma.internetPlan.findMany({
      orderBy: [{ isActive: 'desc' }, { monthlyCents: 'asc' }],
    });
  }
  async findOne(id: string) {
    const plan = await this.prisma.internetPlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('Internet plan not found.');
    return plan;
  }
  async update(id: string, input: UpdatePlanDto) {
    await this.findOne(id);
    const plan = await this.prisma.internetPlan
      .update({ where: { id }, data: input })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
          throw new ConflictException('A plan with this name already exists.');
        throw error;
      });
    await this.dashboardCache.invalidate();
    return plan;
  }

  async remove(id: string) {
    await this.findOne(id);
    const plan = await this.prisma.internetPlan
      .delete({ where: { id } })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
          throw new ConflictException(
            'A plan with subscription history cannot be deleted. Deactivate it instead.',
          );
        }
        throw error;
      });
    await this.dashboardCache.invalidate();
    return plan;
  }
}
