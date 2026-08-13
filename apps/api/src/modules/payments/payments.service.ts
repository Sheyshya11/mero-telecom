import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InvoiceStatus, PaymentProvider, PaymentStatus, Prisma, Role } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import Stripe from 'stripe';

import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AdminDashboardCacheService } from '../cache/admin-dashboard-cache.service';

@Injectable()
export class PaymentsService {
  private readonly stripe: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly dashboardCache: AdminDashboardCacheService,
  ) {
    this.stripe = new Stripe(configService.getOrThrow('stripe').secretKey, {
      apiVersion: '2026-07-29.dahlia',
    });
  }

  async createCheckoutSession(invoiceId: string, actor: AuthenticatedUser) {
    const invoice = await this.prisma.invoice.findFirst({
      where:
        actor.role === Role.CUSTOMER
          ? { id: invoiceId, customer: { userId: actor.id } }
          : { id: invoiceId },
      include: { customer: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found.');
    if (invoice.status !== InvoiceStatus.ISSUED && invoice.status !== InvoiceStatus.OVERDUE) {
      throw new BadRequestException('Only issued or overdue invoices can be paid.');
    }

    const existingPayment = await this.prisma.payment.findFirst({
      where: {
        invoiceId: invoice.id,
        provider: PaymentProvider.STRIPE,
        status: PaymentStatus.PENDING,
        providerSessionId: { not: null },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existingPayment?.providerSessionId) {
      const existingSession = await this.stripe.checkout.sessions.retrieve(
        existingPayment.providerSessionId,
      );
      if (existingSession.status === 'open' && existingSession.url) {
        return { checkoutUrl: existingSession.url, paymentId: existingPayment.id };
      }
    }

    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'payment',
        integration_identifier: `mero_telecom_invoice_${this.randomLetters(8)}`,
        customer_email: invoice.customer.email,
        client_reference_id: invoice.id,
        metadata: { invoiceId: invoice.id, customerId: invoice.customerId },
        payment_intent_data: {
          metadata: { invoiceId: invoice.id, customerId: invoice.customerId },
        },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: invoice.currency.toLowerCase(),
              unit_amount: invoice.totalCents,
              product_data: { name: `Mero Telecom invoice ${invoice.invoiceNumber}` },
            },
          },
        ],
        success_url: `${this.frontendUrl()}/customer/dashboard?payment=success`,
        cancel_url: `${this.frontendUrl()}/customer/dashboard?payment=cancelled`,
      },
      { idempotencyKey: `invoice-checkout-${invoice.id}-${randomUUID()}` },
    );
    if (!session.url) throw new BadRequestException('Stripe did not return a Checkout URL.');

    const payment = await this.prisma.payment.upsert({
      where: { providerSessionId: session.id },
      create: {
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        provider: PaymentProvider.STRIPE,
        providerSessionId: session.id,
        amountCents: invoice.totalCents,
        currency: invoice.currency,
        status: PaymentStatus.PENDING,
      },
      update: {},
    });
    return { checkoutUrl: session.url, paymentId: payment.id };
  }

  async processStripeWebhook(payload: Buffer, signature: string | undefined): Promise<void> {
    if (!signature) throw new BadRequestException('Missing Stripe webhook signature.');
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(payload, signature, this.webhookSecret());
    } catch {
      throw new BadRequestException('Invalid Stripe webhook signature.');
    }
    if (event.type !== 'checkout.session.completed') return;

    const session = event.data.object as Stripe.Checkout.Session;
    if (session.payment_status !== 'paid') return;
    const invoiceId = session.metadata?.invoiceId ?? session.client_reference_id;
    if (!invoiceId)
      throw new BadRequestException('Stripe Checkout session is missing an invoice reference.');

    try {
      await this.prisma.$transaction(
        async (transaction) => {
          const alreadyProcessed = await transaction.paymentWebhookEvent.findUnique({
            where: { providerEventId: event.id },
          });
          if (alreadyProcessed) return;

          const invoice = await transaction.invoice.findUnique({ where: { id: invoiceId } });
          if (!invoice) throw new NotFoundException('Invoice referenced by Stripe was not found.');
          if (
            invoice.customerId !== session.metadata?.customerId ||
            invoice.totalCents !== session.amount_total ||
            session.currency?.toUpperCase() !== invoice.currency
          ) {
            throw new BadRequestException('Stripe Checkout session does not match the invoice.');
          }
          const paymentForSession = await transaction.payment.findUnique({
            where: { providerSessionId: session.id },
          });
          if (
            !paymentForSession ||
            paymentForSession.invoiceId !== invoice.id ||
            paymentForSession.customerId !== invoice.customerId
          ) {
            throw new BadRequestException('Stripe Checkout session does not match the payment.');
          }
          if (paymentForSession.status === PaymentStatus.SUCCEEDED) {
            await transaction.paymentWebhookEvent.create({
              data: {
                provider: PaymentProvider.STRIPE,
                providerEventId: event.id,
                eventType: event.type,
                paymentId: paymentForSession.id,
              },
            });
            return;
          }
          if (paymentForSession.status !== PaymentStatus.PENDING) {
            throw new BadRequestException('Stripe Checkout session is not payable.');
          }
          const paymentIntentId =
            typeof session.payment_intent === 'string'
              ? session.payment_intent
              : session.payment_intent?.id;
          const payment = await transaction.payment.update({
            where: { id: paymentForSession.id },
            data: {
              providerPaymentId: paymentIntentId,
              status: PaymentStatus.SUCCEEDED,
              paidAt: new Date(),
            },
          });
          await transaction.invoice.update({
            where: { id: invoice.id },
            data: { status: InvoiceStatus.PAID, paidAt: new Date() },
          });
          await transaction.paymentWebhookEvent.create({
            data: {
              provider: PaymentProvider.STRIPE,
              providerEventId: event.id,
              eventType: event.type,
              paymentId: payment.id,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return;
      throw error;
    }
    await this.dashboardCache.invalidate();
  }

  private frontendUrl(): string {
    return this.configService.getOrThrow('app').frontendUrl;
  }
  private webhookSecret(): string {
    return this.configService.getOrThrow('stripe').webhookSecret;
  }
  private randomLetters(length: number): string {
    return Array.from(randomBytes(length), (byte) => String.fromCharCode(97 + (byte % 26))).join(
      '',
    );
  }
}
