import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  BillingMode,
  InvoiceStatus,
  InvoiceType,
  Prisma,
  Role,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { amountRange, buildPaginationMeta, dateRange } from '../../common/pagination';
import { BillingService } from '../billing/billing.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AdminDashboardCacheService } from '../cache/admin-dashboard-cache.service';
import { AccountLedgerService } from '../account-ledger/account-ledger.service';
import { NotificationService } from '../notifications/notification.service';
import { GenerateInvoiceDto, InvoiceQueryDto, UpdateInvoiceStatusDto } from './dto/invoice.dto';
import { InvoiceDocumentService, type StoredInvoicePdfData } from './invoice-document.service';

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
    private readonly invoiceDocuments: InvoiceDocumentService,
    private readonly dashboardCache: AdminDashboardCacheService,
    private readonly accountLedger: AccountLedgerService,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  async generate(input: GenerateInvoiceDto) {
    const issueDate = this.toUtcDate(input.issueDate);
    return this.generateForBillingPeriod(input.subscriptionId, issueDate);
  }

  async generateForBillingPeriod(subscriptionId: string, issueDate: Date) {
    const period = this.billing.billingPeriodFor(issueDate);
    try {
      const invoice = await this.prisma.$transaction(
        async (transaction) => {
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(${InvoicesService.invoiceSequenceLock})`;
          const subscription = await transaction.subscription.findUnique({
            where: { id: subscriptionId },
            include: { customer: true, plan: true },
          });
          if (!subscription) throw new NotFoundException('Subscription not found.');
          if (subscription.status !== SubscriptionStatus.ACTIVE) {
            throw new BadRequestException(
              'Invoices can only be generated for active subscriptions.',
            );
          }
          if (subscription.billingMode === BillingMode.STRIPE_RECURRING) {
            throw new ConflictException(
              'Stripe automatically creates recurring invoices for this subscription. Manual recurring invoice generation is disabled.',
            );
          }

          const existing = await this.findExistingStandardInvoice(
            transaction,
            subscription.id,
            period,
          );
          if (existing) {
            return { ...existing, generationResult: 'EXISTING' as const };
          }

          const amounts = this.billing.calculateGstInclusiveAmounts(subscription.monthlyCents);
          const invoiceNumber = await this.nextInvoiceNumber(transaction, issueDate);
          const description = `${subscription.plan.name} monthly internet service — ${this.billing.billingPeriodLabel(issueDate)}`;

          const created = await transaction.invoice.create({
            data: {
              invoiceNumber,
              customerId: subscription.customerId,
              subscriptionId: subscription.id,
              type: InvoiceType.MANUAL,
              issueDate,
              dueDate: this.billing.dueDateFor(issueDate),
              billingPeriodStart: period.start,
              billingPeriodEnd: period.end,
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
          const applied = await this.accountLedger.applyManualInvoiceAdjustments(transaction, {
            customerId: subscription.customerId,
            subscriptionId: subscription.id,
            invoiceId: created.id,
            baseAmountCents: amounts.totalCents,
          });
          if (applied.creditAppliedCents === 0 && applied.debitAppliedCents === 0) {
            return { ...created, generationResult: 'CREATED' as const };
          }
          const adjustedTotalCents =
            amounts.totalCents + applied.debitAppliedCents - applied.creditAppliedCents;
          const adjustedAmounts =
            adjustedTotalCents === 0
              ? { subtotalCents: 0, taxCents: 0, totalCents: 0 }
              : this.billing.calculateGstInclusiveAmounts(adjustedTotalCents);
          const adjusted = await transaction.invoice.update({
            where: { id: created.id },
            data: {
              ...adjustedAmounts,
              status: adjustedTotalCents === 0 ? InvoiceStatus.PAID : InvoiceStatus.ISSUED,
              paidAt: adjustedTotalCents === 0 ? new Date() : null,
              items: {
                create: [
                  ...(applied.debitAppliedCents > 0
                    ? [
                        {
                          description: 'Account debit adjustments',
                          quantity: 1,
                          unitPriceCents: applied.debitAppliedCents,
                          amountCents: applied.debitAppliedCents,
                        },
                      ]
                    : []),
                  ...(applied.creditAppliedCents > 0
                    ? [
                        {
                          description: 'Account credits applied',
                          quantity: 1,
                          unitPriceCents: -applied.creditAppliedCents,
                          amountCents: -applied.creditAppliedCents,
                        },
                      ]
                    : []),
                ],
              },
            },
            include: invoiceInclude,
          });
          return { ...adjusted, generationResult: 'CREATED' as const };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
      if (invoice.generationResult === 'CREATED') {
        await this.dashboardCache.invalidate();
        await this.notifications?.sendInvoiceCreated({
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          userId: invoice.customer.userId,
        });
      }
      return invoice;
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.findExistingStandardInvoice(
          this.prisma,
          subscriptionId,
          period,
        );
        if (existing) return { ...existing, generationResult: 'EXISTING' as const };
        throw new ConflictException({
          code: 'INVOICE_GENERATION_CONFLICT',
          message: 'The invoice could not be generated because another invoice was created.',
        });
      }
      throw error;
    }
  }

  async findForBillingPeriod(subscriptionId: string, billingDate: string) {
    const period = this.billing.billingPeriodFor(this.toUtcDate(billingDate));
    return this.findExistingStandardInvoice(this.prisma, subscriptionId, period);
  }

  async findAll(query: InvoiceQueryDto, actor: AuthenticatedUser) {
    const where: Prisma.InvoiceWhereInput =
      actor.role === Role.CUSTOMER
        ? { customer: { userId: actor.id } }
        : query.customerId
          ? { customerId: query.customerId }
          : {};
    const conditions: Prisma.InvoiceWhereInput[] = [];
    if (query.status === 'REFUNDED' || query.status === 'PARTIALLY_REFUNDED')
      conditions.push({ payments: { some: { status: query.status } } });
    else if (query.status === 'UNPAID') where.status = { in: ['ISSUED', 'OVERDUE'] };
    else if (query.status) where.status = query.status;
    const issueDate = dateRange(query.dateFrom, query.dateTo);
    const totalCents = amountRange(query.minAmount, query.maxAmount);
    if (issueDate) where.issueDate = issueDate;
    if (totalCents) where.totalCents = totalCents;
    const search = query.search?.trim();
    if (search)
      conditions.push({
        OR: [
          { invoiceNumber: { contains: search, mode: 'insensitive' } },
          ...['firstName', 'lastName', 'email', 'customerNumber'].map((field) => ({
            customer: { [field]: { contains: search, mode: 'insensitive' as const } },
          })),
        ],
      });
    if (conditions.length) where.AND = conditions;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where,
        include: {
          customer: {
            select: {
              id: true,
              customerNumber: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          subscription: { select: { id: true, plan: { select: { id: true, name: true } } } },
          payments: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
        orderBy: [{ [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return {
      data,
      meta: buildPaginationMeta(query, total),
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
      pdf: await this.invoiceDocuments.getOrCreate(invoice as StoredInvoicePdfData),
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

  private findExistingStandardInvoice(
    client: Prisma.TransactionClient | PrismaService,
    subscriptionId: string,
    period: { start: Date; end: Date },
  ) {
    // Every lifecycle state, including CANCELLED, continues to reserve the period.
    // Regeneration would obscure the original financial record and can create a new debt.
    return client.invoice.findFirst({
      where: {
        subscriptionId,
        OR: [
          { billingPeriodStart: period.start, billingPeriodEnd: period.end },
          {
            billingPeriodStart: null,
            issueDate: { gte: period.start, lte: period.end },
            planChangeRequest: null,
          },
        ],
      },
      include: invoiceInclude,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
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
