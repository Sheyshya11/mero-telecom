import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus, Prisma, Role, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { BillingService } from '../billing/billing.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AdminDashboardCacheService } from '../cache/admin-dashboard-cache.service';
import { GenerateInvoiceDto, InvoiceQueryDto, UpdateInvoiceStatusDto } from './dto/invoice.dto';
import { InvoicePdfService, type InvoicePdfData } from './invoice-pdf.service';

const invoiceInclude = {
  customer: true,
  subscription: { include: { plan: true } },
  items: true,
  payments: { orderBy: { createdAt: 'desc' }, take: 1 },
} satisfies Prisma.InvoiceInclude;

@Injectable()
export class InvoicesService {
  private static readonly invoiceSequenceLock = BigInt(873201);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly invoicePdf: InvoicePdfService,
    private readonly dashboardCache: AdminDashboardCacheService,
  ) {}

  async generate(input: GenerateInvoiceDto) {
    const issueDate = this.toUtcDate(input.issueDate);
    const invoice = await this.prisma
      .$transaction(
        async (transaction) => {
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(${InvoicesService.invoiceSequenceLock})`;
          const subscription = await transaction.subscription.findUnique({
            where: { id: input.subscriptionId },
            include: { customer: true, plan: true },
          });
          if (!subscription) throw new NotFoundException('Subscription not found.');
          if (subscription.status !== SubscriptionStatus.ACTIVE) {
            throw new BadRequestException(
              'Invoices can only be generated for active subscriptions.',
            );
          }

          const existing = await transaction.invoice.findUnique({
            where: { subscriptionId_issueDate: { subscriptionId: subscription.id, issueDate } },
          });
          if (existing) {
            throw new ConflictException(
              'An invoice already exists for this subscription and billing period.',
            );
          }

          const amounts = this.billing.calculateGstInclusiveAmounts(subscription.plan.monthlyCents);
          const invoiceNumber = await this.nextInvoiceNumber(transaction, issueDate);
          const description = `${subscription.plan.name} monthly internet service — ${this.billing.billingPeriodLabel(issueDate)}`;

          return transaction.invoice.create({
            data: {
              invoiceNumber,
              customerId: subscription.customerId,
              subscriptionId: subscription.id,
              issueDate,
              dueDate: this.billing.dueDateFor(issueDate),
              ...amounts,
              status: InvoiceStatus.ISSUED,
              issuedAt: new Date(),
              items: {
                create: {
                  description,
                  quantity: 1,
                  unitPriceCents: amounts.totalCents,
                  amountCents: amounts.totalCents,
                },
              },
            },
            include: invoiceInclude,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException(
            'An invoice already exists for this subscription and billing period.',
          );
        }
        throw error;
      });
    await this.dashboardCache.invalidate();
    return invoice;
  }

  async findAll(query: InvoiceQueryDto, actor: AuthenticatedUser) {
    const where: Prisma.InvoiceWhereInput =
      actor.role === Role.CUSTOMER
        ? { customer: { userId: actor.id } }
        : query.customerId
          ? { customerId: query.customerId }
          : {};
    const [data, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where,
        include: invoiceInclude,
        orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return {
      data,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  async findOne(id: string, actor: AuthenticatedUser) {
    const where: Prisma.InvoiceWhereInput =
      actor.role === Role.CUSTOMER ? { id, customer: { userId: actor.id } } : { id };
    const invoice = await this.prisma.invoice.findFirst({ where, include: invoiceInclude });
    if (!invoice) throw new NotFoundException('Invoice not found.');
    return invoice;
  }

  async updateStatus(id: string, input: UpdateInvoiceStatusDto) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundException('Invoice not found.');
    this.assertTransition(invoice.status, input.status);
    const updated = await this.prisma.invoice.update({
      where: { id },
      data: {
        status: input.status,
        issuedAt: input.status === InvoiceStatus.ISSUED ? new Date() : undefined,
      },
      include: invoiceInclude,
    });
    await this.dashboardCache.invalidate();
    return updated;
  }

  async renderPdf(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<{ pdf: Buffer; invoiceNumber: string }> {
    const invoice = await this.findOne(id, actor);
    return {
      pdf: await this.invoicePdf.render(invoice as InvoicePdfData),
      invoiceNumber: invoice.invoiceNumber,
    };
  }

  private async nextInvoiceNumber(
    transaction: Prisma.TransactionClient,
    issueDate: Date,
  ): Promise<string> {
    const year = issueDate.getUTCFullYear();
    const prefix = `INV-${year}-`;
    const latest = await transaction.invoice.findFirst({
      where: { invoiceNumber: { startsWith: prefix } },
      orderBy: { invoiceNumber: 'desc' },
      select: { invoiceNumber: true },
    });
    const next = latest ? Number(latest.invoiceNumber.slice(prefix.length)) + 1 : 1;
    return `${prefix}${next.toString().padStart(6, '0')}`;
  }

  private toUtcDate(value?: string): Date {
    const rawDate = value ?? new Date().toISOString().slice(0, 10);
    const date = new Date(`${rawDate}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()))
      throw new BadRequestException('A valid issue date is required.');
    return date;
  }

  private assertTransition(from: InvoiceStatus, to: InvoiceStatus) {
    const allowed: Record<InvoiceStatus, InvoiceStatus[]> = {
      DRAFT: [InvoiceStatus.ISSUED, InvoiceStatus.CANCELLED],
      ISSUED: [InvoiceStatus.OVERDUE, InvoiceStatus.CANCELLED],
      PAID: [],
      OVERDUE: [InvoiceStatus.CANCELLED],
      CANCELLED: [],
    };
    if (from !== to && !allowed[from].includes(to)) {
      throw new BadRequestException(
        `Cannot change an ${from.toLowerCase()} invoice to ${to.toLowerCase()}.`,
      );
    }
  }
}
