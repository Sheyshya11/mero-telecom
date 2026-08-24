import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AccountInvitationReason,
  AddressType,
  CheckoutApplicationStatus,
  CustomerStatus,
  InvoiceStatus,
  PaymentProvider,
  PaymentStatus,
  Prisma,
  Role,
  SubscriptionStatus,
  UserStatus,
} from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import type Stripe from 'stripe';

import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';
import {
  AccountInvitationsService,
  type IssuedAccountInvitation,
} from '../auth/account-invitations.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { BillingService } from '../billing/billing.service';
import { AdminDashboardCacheService } from '../cache/admin-dashboard-cache.service';
import { CoverageService } from '../coverage/coverage.service';
import { NotificationService } from '../notifications/notification.service';
import type { CreatePublicPlanCheckoutSessionDto } from './dto/create-checkout-session.dto';
import { StripeClientService } from './stripe-client.service';
import { PlanChangesService } from '../plan-changes/plan-changes.service';

const planPurchaseInclude = {
  customer: true,
  purchasePlan: true,
  payments: {
    where: { provider: PaymentProvider.STRIPE, status: PaymentStatus.PENDING },
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
} satisfies Prisma.InvoiceInclude;

type PlanPurchaseInvoice = Prisma.InvoiceGetPayload<{ include: typeof planPurchaseInclude }>;

interface StoredAddress {
  addressLine1: string;
  addressLine2?: string | null;
  suburb: string;
  state: string;
  postcode: string;
}

interface PublicCheckoutCompletion {
  invitation: IssuedAccountInvitation;
  customerName: string;
  customerEmail: string;
  planName: string;
  invoiceNumber: string;
  totalCents: number;
  currency: string;
}

@Injectable()
export class PaymentsService {
  private static readonly invoiceSequenceLock = BigInt(873201);
  private readonly logger = new Logger(PaymentsService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<AppConfig, true>,
    stripeClient: StripeClientService,
    private readonly dashboardCache: AdminDashboardCacheService,
    private readonly billing: BillingService,
    private readonly coverage: CoverageService,
    private readonly invitations: AccountInvitationsService,
    private readonly notifications: NotificationService,
    private readonly planChanges: PlanChangesService,
  ) {
    this.stripe = stripeClient.client;
  }

  async createPublicPlanCheckoutSession(input: CreatePublicPlanCheckoutSessionDto) {
    const applicantEmail = input.email.trim().toLowerCase();
    const [plan, existingUser, existingCustomer] = await Promise.all([
      this.prisma.internetPlan.findUnique({ where: { id: input.planId } }),
      this.prisma.user.findUnique({ where: { email: applicantEmail }, select: { id: true } }),
      this.prisma.customer.findUnique({
        where: { email: applicantEmail },
        select: { id: true },
      }),
    ]);
    if (!plan) throw new NotFoundException('Internet plan not found.');
    if (!plan.isActive || !plan.isPublic || !plan.isAvailable) {
      throw new BadRequestException('This internet plan is not available for online purchase.');
    }
    if (existingUser || existingCustomer) {
      throw new ConflictException(
        'An account already exists for this email. Sign in to continue with your selected plan.',
      );
    }
    if (this.coverage.statusFor(Number(input.serviceAddress.postcode)) !== 'AVAILABLE') {
      throw new BadRequestException(
        'Mero Telecom service is not currently orderable at this address.',
      );
    }

    const now = new Date();
    await this.prisma.checkoutApplication.updateMany({
      where: {
        applicantEmail,
        status: {
          in: [
            CheckoutApplicationStatus.PENDING_PAYMENT,
            CheckoutApplicationStatus.PAYMENT_PROCESSING,
          ],
        },
        expiresAt: { lte: now },
      },
      data: { status: CheckoutApplicationStatus.EXPIRED },
    });
    const inProgress = await this.prisma.checkoutApplication.findFirst({
      where: {
        applicantEmail,
        status: {
          in: [
            CheckoutApplicationStatus.PENDING_PAYMENT,
            CheckoutApplicationStatus.PAYMENT_PROCESSING,
          ],
        },
      },
      select: { id: true },
    });
    if (inProgress) {
      throw new ConflictException(
        'A checkout is already in progress for this email. Complete it or wait for it to expire.',
      );
    }

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    let application;
    try {
      application = await this.prisma.checkoutApplication.create({
        data: {
          planId: plan.id,
          applicantEmail,
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          phone: input.phone,
          residentialAddress: this.addressJson(input.residentialAddress),
          serviceAddress: this.addressJson(input.serviceAddress),
          billingAddress: this.addressJson(input.billingAddress),
          termsAcceptedAt: now,
          privacyAcceptedAt: now,
          amountCents: plan.monthlyCents,
          expiresAt,
        },
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A checkout is already in progress for this email.');
      }
      throw error;
    }

    const metadata = {
      checkoutKind: 'public_subscription',
      checkoutApplicationId: application.id,
      planId: plan.id,
    };
    try {
      const session = await this.stripe.checkout.sessions.create(
        {
          mode: 'payment',
          integration_identifier: `mero_telecom_public_${this.randomLetters(8)}`,
          customer_creation: 'always',
          customer_email: applicantEmail,
          client_reference_id: application.id,
          metadata,
          payment_intent_data: { metadata },
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: application.currency.toLowerCase(),
                unit_amount: application.amountCents,
                product_data: { name: `${plan.name} monthly internet plan` },
              },
            },
          ],
          expires_at: Math.floor(expiresAt.getTime() / 1000),
          success_url: `${this.frontendUrl()}/checkout/status?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${this.frontendUrl()}/checkout/cancelled?applicationId=${application.id}`,
        },
        { idempotencyKey: `public-plan-checkout-${application.id}` },
      );
      if (!session.url) throw new BadRequestException('Stripe did not return a Checkout URL.');
      await this.prisma.checkoutApplication.update({
        where: { id: application.id },
        data: { stripeCheckoutSessionId: session.id },
      });
      return { checkoutUrl: session.url };
    } catch (error: unknown) {
      await this.prisma.checkoutApplication.updateMany({
        where: {
          id: application.id,
          status: CheckoutApplicationStatus.PENDING_PAYMENT,
          stripeCheckoutSessionId: null,
        },
        data: { status: CheckoutApplicationStatus.FAILED },
      });
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Secure payment checkout could not be started. Please retry.');
    }
  }

  async getPublicCheckoutStatus(sessionId: string) {
    if (!/^cs_(?:test|live)_/.test(sessionId)) {
      throw new BadRequestException('A valid Stripe Checkout Session ID is required.');
    }
    let application = await this.loadPublicCheckoutStatus(sessionId);
    if (!application) throw new NotFoundException('Checkout status not found.');

    if (
      application.status === CheckoutApplicationStatus.PENDING_PAYMENT ||
      application.status === CheckoutApplicationStatus.PAYMENT_PROCESSING
    ) {
      const session = await this.stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status === 'paid') {
        await this.finalizePublicCheckout(
          `reconcile:${session.id}`,
          'server.checkout_reconciliation',
          session,
        );
      } else if (session.status === 'expired') {
        await this.recordPublicCheckoutState(
          `reconcile:${session.id}:expired`,
          'server.checkout_expired',
          session,
          CheckoutApplicationStatus.EXPIRED,
        );
      } else if (session.status === 'complete') {
        await this.recordPublicCheckoutState(
          `reconcile:${session.id}:processing`,
          'server.checkout_processing',
          session,
          CheckoutApplicationStatus.PAYMENT_PROCESSING,
        );
      }
      application = await this.loadPublicCheckoutStatus(sessionId);
      if (!application) throw new NotFoundException('Checkout status not found.');
    }

    return {
      status: application.status,
      paymentStatus: application.payment?.status ?? null,
      subscriptionStatus: application.subscription?.status ?? null,
      accountStatus: application.customer?.user?.status ?? null,
      activationRequired: application.customer?.user?.status === UserStatus.INVITATION_PENDING,
    };
  }

  async getAuthenticatedCheckoutStatus(sessionId: string, actor: AuthenticatedUser) {
    if (!/^cs_(?:test|live)_/.test(sessionId)) {
      throw new BadRequestException('A valid Stripe Checkout Session ID is required.');
    }
    const ownedPayment = await this.prisma.payment.findFirst({
      where: {
        provider: PaymentProvider.STRIPE,
        providerSessionId: sessionId,
        customer: { userId: actor.id },
      },
      select: { id: true },
    });
    if (!ownedPayment) throw new NotFoundException('Checkout status not found.');

    const session = await this.stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status === 'paid') {
      await this.finalizeInvoiceCheckout(
        this.reconciliationEventId(session.id),
        'server.checkout_reconciliation',
        session,
      );
    }

    const payment = await this.prisma.payment.findUnique({
      where: { id: ownedPayment.id },
      include: {
        invoice: {
          select: {
            status: true,
            subscription: { select: { id: true, status: true, plan: { select: { name: true } } } },
          },
        },
      },
    });
    if (!payment) throw new NotFoundException('Checkout status not found.');

    return {
      checkoutStatus: session.status,
      stripePaymentStatus: session.payment_status,
      paymentStatus: payment.status,
      invoiceStatus: payment.invoice.status,
      subscription: payment.invoice.subscription,
    };
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
    if (invoice.purchasePlanId) {
      return this.createPlanCheckoutSession(invoice.purchasePlanId, actor);
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
      if (existingSession.payment_status === 'paid') {
        await this.finalizeInvoiceCheckout(
          this.reconciliationEventId(existingSession.id),
          'server.checkout_reconciliation',
          existingSession,
        );
        return { checkoutUrl: null, paymentId: existingPayment.id, reconciled: true };
      }
      if (existingSession.status === 'complete') {
        throw new ConflictException('Your payment is already complete or still processing.');
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
        success_url: `${this.frontendUrl()}/customer/dashboard?payment=success&sessionId={CHECKOUT_SESSION_ID}`,
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

  async createPlanCheckoutSession(planId: string, actor: AuthenticatedUser) {
    const [customer, plan] = await Promise.all([
      this.prisma.customer.findUnique({ where: { userId: actor.id } }),
      this.prisma.internetPlan.findUnique({ where: { id: planId } }),
    ]);
    if (!customer) throw new NotFoundException('Customer account not found.');
    if (customer.status !== CustomerStatus.ACTIVE) {
      throw new BadRequestException('Only active customer accounts can purchase a plan.');
    }
    if (!plan) throw new NotFoundException('Internet plan not found.');
    if (!plan.isActive || !plan.isPublic || !plan.isAvailable) {
      throw new BadRequestException('This internet plan is not available.');
    }

    await this.assertCanPurchasePlan(customer.id);

    let invoice = await this.findOpenPlanPurchase(customer.id);
    if (invoice) {
      const reconciled = await this.reconcilePaidPlanPurchase(invoice);
      if (reconciled) return reconciled;
      const selectionChanged =
        invoice.purchasePlanId !== plan.id || invoice.totalCents !== plan.monthlyCents;
      if (selectionChanged || !(await this.isReusablePlanPurchase(invoice))) {
        await this.cancelOpenPlanPurchase(invoice);
        invoice = null;
      }
    }

    invoice ??= await this.createPlanPurchaseInvoice(customer.id, plan.id);
    if (invoice.purchasePlanId !== plan.id || invoice.totalCents !== plan.monthlyCents) {
      throw new ConflictException('Another plan checkout is already in progress. Please retry.');
    }
    const checkout = await this.createStripePlanSession(invoice);
    await this.dashboardCache.invalidate();
    return checkout;
  }

  async processStripeWebhook(payload: Buffer, signature: string | undefined): Promise<void> {
    if (!signature) throw new BadRequestException('Missing Stripe webhook signature.');
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(payload, signature, this.webhookSecret());
    } catch {
      throw new BadRequestException('Invalid Stripe webhook signature.');
    }
    if (
      event.type !== 'checkout.session.completed' &&
      event.type !== 'checkout.session.async_payment_succeeded' &&
      event.type !== 'checkout.session.async_payment_failed' &&
      event.type !== 'checkout.session.expired'
    )
      return;

    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.checkoutKind === 'plan_change') {
      await this.planChanges.processStripeEvent(event, session);
      return;
    }
    if (session.metadata?.checkoutKind === 'public_subscription') {
      await this.processPublicCheckoutEvent(event, session);
      return;
    }
    if (
      event.type !== 'checkout.session.completed' &&
      event.type !== 'checkout.session.async_payment_succeeded'
    )
      return;
    if (session.payment_status !== 'paid') return;

    await this.finalizeInvoiceCheckout(event.id, event.type, session);
  }

  private async finalizeInvoiceCheckout(
    providerEventId: string,
    eventType: string,
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    if (session.payment_status !== 'paid') return;
    const invoiceId = session.metadata?.invoiceId ?? session.client_reference_id;
    if (!invoiceId)
      throw new BadRequestException('Stripe Checkout session is missing an invoice reference.');

    try {
      await this.prisma.$transaction(
        async (transaction) => {
          const alreadyProcessed = await transaction.paymentWebhookEvent.findUnique({
            where: { providerEventId },
          });
          if (alreadyProcessed) return;

          const invoice = await transaction.invoice.findUnique({
            where: { id: invoiceId },
            include: { purchasePlan: true },
          });
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
                providerEventId,
                eventType,
                paymentId: paymentForSession.id,
              },
            });
            return;
          }
          if (paymentForSession.status !== PaymentStatus.PENDING) {
            throw new BadRequestException('Stripe Checkout session is not payable.');
          }
          let activatedSubscriptionId: string | undefined;
          if (invoice.purchasePlanId) {
            if (
              session.metadata?.checkoutKind !== 'plan_purchase' ||
              session.metadata.planId !== invoice.purchasePlanId
            ) {
              throw new BadRequestException('Stripe Checkout session does not match the plan.');
            }
            const currentSubscription = await transaction.subscription.findFirst({
              where: {
                customerId: invoice.customerId,
                status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.SUSPENDED] },
              },
            });
            if (currentSubscription) {
              throw new ConflictException('The customer already has a current subscription.');
            }
            const activatedAt = new Date();
            const billingAnchorDay = activatedAt.getUTCDate();
            const subscription = await transaction.subscription.create({
              data: {
                customerId: invoice.customerId,
                planId: invoice.purchasePlanId,
                status: SubscriptionStatus.ACTIVE,
                startDate: this.utcDate(activatedAt),
                billingAnchorDay,
                currentPeriodStart: activatedAt,
                currentPeriodEnd: this.billing.nextMonthlyBoundary(activatedAt, billingAnchorDay),
              },
            });
            activatedSubscriptionId = subscription.id;
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
            data: {
              status: InvoiceStatus.PAID,
              paidAt: new Date(),
              subscriptionId: activatedSubscriptionId,
            },
          });
          await transaction.paymentWebhookEvent.create({
            data: {
              provider: PaymentProvider.STRIPE,
              providerEventId,
              eventType,
              paymentId: payment.id,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const storedEvent = await this.prisma.paymentWebhookEvent.findUnique({
          where: { providerEventId },
        });
        if (storedEvent) return;
      }
      throw error;
    }
    await this.dashboardCache.invalidate();
  }

  private async processPublicCheckoutEvent(
    event: Stripe.Event,
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    if (event.type === 'checkout.session.completed' && session.payment_status !== 'paid') {
      await this.recordPublicCheckoutState(
        event.id,
        event.type,
        session,
        CheckoutApplicationStatus.PAYMENT_PROCESSING,
      );
      return;
    }
    if (event.type === 'checkout.session.async_payment_failed') {
      await this.recordPublicCheckoutState(
        event.id,
        event.type,
        session,
        CheckoutApplicationStatus.FAILED,
      );
      return;
    }
    if (event.type === 'checkout.session.expired') {
      await this.recordPublicCheckoutState(
        event.id,
        event.type,
        session,
        CheckoutApplicationStatus.EXPIRED,
      );
      return;
    }
    if (session.payment_status === 'paid') {
      await this.finalizePublicCheckout(event.id, event.type, session);
    }
  }

  private async recordPublicCheckoutState(
    providerEventId: string,
    eventType: string,
    session: Stripe.Checkout.Session,
    status: CheckoutApplicationStatus,
  ): Promise<void> {
    const applicationId = session.metadata?.checkoutApplicationId ?? session.client_reference_id;
    if (!applicationId) {
      throw new BadRequestException('Stripe Checkout session is missing an application reference.');
    }
    await this.prisma.$transaction(async (transaction) => {
      if (await transaction.paymentWebhookEvent.findUnique({ where: { providerEventId } })) {
        return;
      }
      const application = await transaction.checkoutApplication.findUnique({
        where: { id: applicationId },
      });
      if (!application || application.stripeCheckoutSessionId !== session.id) {
        throw new BadRequestException('Stripe Checkout session does not match the application.');
      }
      await transaction.checkoutApplication.updateMany({
        where: {
          id: application.id,
          status: {
            in: [
              CheckoutApplicationStatus.PENDING_PAYMENT,
              CheckoutApplicationStatus.PAYMENT_PROCESSING,
            ],
          },
        },
        data: { status },
      });
      await transaction.paymentWebhookEvent.create({
        data: {
          provider: PaymentProvider.STRIPE,
          providerEventId,
          eventType,
        },
      });
    });
    await this.dashboardCache.invalidate();
  }

  private async finalizePublicCheckout(
    providerEventId: string,
    eventType: string,
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    const applicationId = session.metadata?.checkoutApplicationId ?? session.client_reference_id;
    if (!applicationId) {
      throw new BadRequestException('Stripe Checkout session is missing an application reference.');
    }

    let completion: PublicCheckoutCompletion | null = null;
    try {
      completion = await this.prisma.$transaction(
        async (transaction): Promise<PublicCheckoutCompletion | null> => {
          const processedEvent = await transaction.paymentWebhookEvent.findUnique({
            where: { providerEventId },
          });
          if (processedEvent) return null;

          const application = await transaction.checkoutApplication.findUnique({
            where: { id: applicationId },
            include: { plan: true },
          });
          if (!application) {
            throw new NotFoundException('Checkout application referenced by Stripe was not found.');
          }
          const paymentIntentId = this.stripeId(session.payment_intent);
          const stripeCustomerId = this.stripeId(session.customer);
          const checkoutEmail = session.customer_details?.email?.trim().toLowerCase();
          if (
            application.stripeCheckoutSessionId !== session.id ||
            application.planId !== session.metadata?.planId ||
            application.amountCents !== session.amount_total ||
            session.currency?.toUpperCase() !== application.currency ||
            (checkoutEmail && checkoutEmail !== application.applicantEmail)
          ) {
            throw new BadRequestException(
              'Stripe Checkout session does not match the application.',
            );
          }
          if (application.status === CheckoutApplicationStatus.COMPLETED) {
            await transaction.paymentWebhookEvent.create({
              data: {
                provider: PaymentProvider.STRIPE,
                providerEventId,
                eventType,
                paymentId: application.paymentId,
              },
            });
            return null;
          }
          if (application.status === CheckoutApplicationStatus.REQUIRES_REVIEW) {
            await transaction.paymentWebhookEvent.create({
              data: { provider: PaymentProvider.STRIPE, providerEventId, eventType },
            });
            return null;
          }

          const [existingUser, existingCustomer] = await Promise.all([
            transaction.user.findUnique({
              where: { email: application.applicantEmail },
              select: { id: true },
            }),
            transaction.customer.findUnique({
              where: { email: application.applicantEmail },
              select: { id: true },
            }),
          ]);
          if (
            existingUser ||
            existingCustomer ||
            !application.plan.isActive ||
            !application.plan.isPublic ||
            !application.plan.isAvailable
          ) {
            await transaction.checkoutApplication.update({
              where: { id: application.id },
              data: {
                status: CheckoutApplicationStatus.REQUIRES_REVIEW,
                stripePaymentIntentId: paymentIntentId,
                stripeCustomerId,
              },
            });
            await transaction.paymentWebhookEvent.create({
              data: { provider: PaymentProvider.STRIPE, providerEventId, eventType },
            });
            await transaction.auditLog.create({
              data: {
                action: 'PAID_CHECKOUT_REQUIRES_REVIEW',
                entityType: 'CheckoutApplication',
                entityId: application.id,
                metadata: {
                  reason: existingUser || existingCustomer ? 'EMAIL_CONFLICT' : 'PLAN_UNAVAILABLE',
                },
              },
            });
            return null;
          }

          const residential = this.storedAddress(application.residentialAddress);
          const service = this.storedAddress(application.serviceAddress);
          const billing = this.storedAddress(application.billingAddress);
          const user = await transaction.user.create({
            data: {
              email: application.applicantEmail,
              passwordHash: null,
              role: Role.CUSTOMER,
              isActive: false,
              status: UserStatus.INVITATION_PENDING,
            },
          });
          const customer = await transaction.customer.create({
            data: {
              userId: user.id,
              stripeCustomerId,
              customerNumber: this.createCustomerNumber(),
              firstName: application.firstName,
              lastName: application.lastName,
              email: application.applicantEmail,
              phone: application.phone,
              ...residential,
              state: residential.state.toUpperCase(),
              status: CustomerStatus.INVITATION_PENDING,
              addresses: {
                create: [
                  this.customerAddress(AddressType.RESIDENTIAL, residential),
                  this.customerAddress(AddressType.SERVICE, service),
                  this.customerAddress(AddressType.BILLING, billing),
                ],
              },
            },
          });
          const paidAt = new Date();
          const billingAnchorDay = paidAt.getUTCDate();
          const subscription = await transaction.subscription.create({
            data: {
              customerId: customer.id,
              planId: application.planId,
              status: SubscriptionStatus.ACTIVE,
              startDate: this.utcDate(paidAt),
              billingAnchorDay,
              currentPeriodStart: paidAt,
              currentPeriodEnd: this.billing.nextMonthlyBoundary(paidAt, billingAnchorDay),
            },
          });
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(${PaymentsService.invoiceSequenceLock})`;
          const issueDate = this.utcDate(paidAt);
          const amounts = this.billing.calculateGstInclusiveAmounts(application.amountCents);
          const invoiceNumber = await this.nextInvoiceNumber(transaction, issueDate);
          const invoice = await transaction.invoice.create({
            data: {
              invoiceNumber,
              customerId: customer.id,
              subscriptionId: subscription.id,
              purchasePlanId: application.planId,
              issueDate,
              dueDate: this.billing.dueDateFor(issueDate),
              ...amounts,
              currency: application.currency,
              status: InvoiceStatus.PAID,
              issuedAt: paidAt,
              paidAt,
              items: {
                create: {
                  description: `${application.plan.name} initial monthly internet service — ${this.billing.billingPeriodLabel(issueDate)}`,
                  quantity: 1,
                  unitPriceCents: amounts.totalCents,
                  amountCents: amounts.totalCents,
                },
              },
            },
          });
          const payment = await transaction.payment.create({
            data: {
              invoiceId: invoice.id,
              customerId: customer.id,
              provider: PaymentProvider.STRIPE,
              providerSessionId: session.id,
              providerPaymentId: paymentIntentId,
              amountCents: application.amountCents,
              currency: application.currency,
              status: PaymentStatus.SUCCEEDED,
              paidAt,
            },
          });
          const invitation = await this.invitations.issueWithinTransaction(transaction, {
            userId: user.id,
            reason: AccountInvitationReason.ONLINE_PURCHASE,
            checkoutApplicationId: application.id,
          });
          await transaction.checkoutApplication.update({
            where: { id: application.id },
            data: {
              status: CheckoutApplicationStatus.COMPLETED,
              stripePaymentIntentId: paymentIntentId,
              stripeCustomerId,
              customerId: customer.id,
              invoiceId: invoice.id,
              paymentId: payment.id,
              subscriptionId: subscription.id,
              completedAt: paidAt,
            },
          });
          await transaction.paymentWebhookEvent.create({
            data: {
              provider: PaymentProvider.STRIPE,
              providerEventId,
              eventType,
              paymentId: payment.id,
            },
          });
          await transaction.auditLog.createMany({
            data: [
              {
                action: 'CUSTOMER_SUBSCRIBED',
                entityType: 'Customer',
                entityId: customer.id,
                metadata: { source: 'ONLINE_PURCHASE', planId: application.planId },
              },
              {
                action: 'PAYMENT_SUCCEEDED',
                entityType: 'Payment',
                entityId: payment.id,
                metadata: { invoiceId: invoice.id, amountCents: payment.amountCents },
              },
              {
                action: 'SUBSCRIPTION_ACTIVATED',
                entityType: 'Subscription',
                entityId: subscription.id,
                metadata: { customerId: customer.id, planId: application.planId },
              },
              {
                action: 'INVOICE_CREATED',
                entityType: 'Invoice',
                entityId: invoice.id,
                metadata: { invoiceNumber },
              },
            ],
          });

          return {
            invitation,
            customerName: `${customer.firstName} ${customer.lastName}`,
            customerEmail: customer.email,
            planName: application.plan.name,
            invoiceNumber,
            totalCents: invoice.totalCents,
            currency: invoice.currency,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const storedEvent = await this.prisma.paymentWebhookEvent.findUnique({
          where: { providerEventId },
        });
        if (storedEvent) return;
        await this.markPublicCheckoutForReview(applicationId, providerEventId, eventType, session);
        return;
      }
      throw error;
    }

    if (completion) {
      await this.invitations.queueDelivery(completion.invitation);
      try {
        await this.notifications.sendSubscriptionConfirmation({
          customerName: completion.customerName,
          customerEmail: completion.customerEmail,
          planName: completion.planName,
          invoiceNumber: completion.invoiceNumber,
          totalCents: completion.totalCents,
          currency: completion.currency,
          activationPending: true,
          checkoutApplicationId: applicationId,
        });
      } catch (error: unknown) {
        this.logger.error(
          JSON.stringify({
            event: 'subscription_confirmation_delivery_failed',
            checkoutApplicationId: applicationId,
            error: error instanceof Error ? error.name : 'UnknownError',
          }),
        );
      }
    }
    await this.dashboardCache.invalidate();
  }

  private async markPublicCheckoutForReview(
    applicationId: string,
    providerEventId: string,
    eventType: string,
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    try {
      await this.prisma.$transaction([
        this.prisma.checkoutApplication.update({
          where: { id: applicationId },
          data: {
            status: CheckoutApplicationStatus.REQUIRES_REVIEW,
            stripePaymentIntentId: this.stripeId(session.payment_intent),
            stripeCustomerId: this.stripeId(session.customer),
          },
        }),
        this.prisma.paymentWebhookEvent.create({
          data: { provider: PaymentProvider.STRIPE, providerEventId, eventType },
        }),
      ]);
    } catch (error: unknown) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        throw error;
      }
    }
  }

  private loadPublicCheckoutStatus(sessionId: string) {
    return this.prisma.checkoutApplication.findUnique({
      where: { stripeCheckoutSessionId: sessionId },
      include: {
        payment: { select: { status: true } },
        subscription: { select: { status: true } },
        customer: { include: { user: { select: { status: true } } } },
      },
    });
  }

  private addressJson(address: StoredAddress): Prisma.InputJsonObject {
    return {
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2 ?? null,
      suburb: address.suburb,
      state: address.state.toUpperCase(),
      postcode: address.postcode,
    };
  }

  private storedAddress(value: Prisma.JsonValue): StoredAddress {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new BadRequestException('Checkout application address data is invalid.');
    }
    const address = value as Record<string, Prisma.JsonValue>;
    const required = ['addressLine1', 'suburb', 'state', 'postcode'] as const;
    if (required.some((field) => typeof address[field] !== 'string')) {
      throw new BadRequestException('Checkout application address data is incomplete.');
    }
    return {
      addressLine1: address.addressLine1 as string,
      addressLine2: typeof address.addressLine2 === 'string' ? address.addressLine2 : null,
      suburb: address.suburb as string,
      state: address.state as string,
      postcode: address.postcode as string,
    };
  }

  private customerAddress(type: AddressType, address: StoredAddress) {
    return {
      type,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2 || null,
      suburb: address.suburb,
      state: address.state.toUpperCase(),
      postcode: address.postcode,
    };
  }

  private stripeId(value: string | { id: string } | null): string | undefined {
    if (typeof value === 'string') return value;
    return value?.id;
  }

  private createCustomerNumber(): string {
    const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    return `CUST-${date}-${randomBytes(3).toString('hex').toUpperCase()}`;
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

  private reconciliationEventId(sessionId: string): string {
    return `reconcile:${sessionId}`;
  }

  private async assertCanPurchasePlan(customerId: string): Promise<void> {
    const current = await this.prisma.subscription.count({
      where: {
        customerId,
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.SUSPENDED] },
      },
    });
    if (current) {
      throw new ConflictException(
        'You already have a current subscription. Contact support to change plans.',
      );
    }
  }

  private findOpenPlanPurchase(customerId: string): Promise<PlanPurchaseInvoice | null> {
    return this.prisma.invoice.findFirst({
      where: {
        customerId,
        purchasePlanId: { not: null },
        status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.OVERDUE] },
      },
      include: planPurchaseInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  private async isReusablePlanPurchase(invoice: PlanPurchaseInvoice): Promise<boolean> {
    const payment = invoice.payments[0];
    if (!payment?.providerSessionId) return true;
    const session = await this.stripe.checkout.sessions.retrieve(payment.providerSessionId);
    if (session.status === 'open') return true;
    if (session.status === 'complete') {
      throw new ConflictException(
        session.payment_status === 'paid'
          ? 'Your payment has completed and the subscription is being activated.'
          : 'Your payment is still processing. You cannot change plans yet.',
      );
    }
    return false;
  }

  private async reconcilePaidPlanPurchase(invoice: PlanPurchaseInvoice) {
    const payment = invoice.payments[0];
    if (!payment?.providerSessionId) return null;
    const session = await this.stripe.checkout.sessions.retrieve(payment.providerSessionId);
    if (session.payment_status !== 'paid') return null;

    await this.finalizeInvoiceCheckout(
      this.reconciliationEventId(session.id),
      'server.checkout_reconciliation',
      session,
    );
    return { checkoutUrl: null, paymentId: payment.id, reconciled: true };
  }

  private async cancelOpenPlanPurchase(invoice: PlanPurchaseInvoice): Promise<void> {
    const payment = invoice.payments[0];
    if (payment?.providerSessionId) {
      const session = await this.stripe.checkout.sessions.retrieve(payment.providerSessionId);
      if (session.status === 'complete') {
        throw new ConflictException(
          session.payment_status === 'paid'
            ? 'Your payment has completed and the subscription is being activated.'
            : 'Your payment is still processing. You cannot change plans yet.',
        );
      }
      if (session.status === 'open') {
        await this.stripe.checkout.sessions.expire(session.id);
      }
    }
    await this.prisma.$transaction([
      this.prisma.payment.updateMany({
        where: { invoiceId: invoice.id, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.FAILED },
      }),
      this.prisma.invoice.updateMany({
        where: {
          id: invoice.id,
          status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.OVERDUE] },
        },
        data: { status: InvoiceStatus.CANCELLED },
      }),
    ]);
  }

  private async createPlanPurchaseInvoice(
    customerId: string,
    planId: string,
  ): Promise<PlanPurchaseInvoice> {
    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(${PaymentsService.invoiceSequenceLock})`;
          const existing = await transaction.invoice.findFirst({
            where: {
              customerId,
              purchasePlanId: { not: null },
              status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.OVERDUE] },
            },
            include: planPurchaseInclude,
          });
          if (existing) return existing;

          const currentSubscription = await transaction.subscription.count({
            where: {
              customerId,
              status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.SUSPENDED] },
            },
          });
          if (currentSubscription) {
            throw new ConflictException('The customer already has a current subscription.');
          }
          const plan = await transaction.internetPlan.findUnique({ where: { id: planId } });
          if (!plan || !plan.isActive || !plan.isPublic || !plan.isAvailable) {
            throw new BadRequestException('This internet plan is not available.');
          }

          const issueDate = this.utcDate(new Date());
          const amounts = this.billing.calculateGstInclusiveAmounts(plan.monthlyCents);
          const invoiceNumber = await this.nextInvoiceNumber(transaction, issueDate);
          return transaction.invoice.create({
            data: {
              invoiceNumber,
              customerId,
              purchasePlanId: plan.id,
              issueDate,
              dueDate: this.billing.dueDateFor(issueDate),
              ...amounts,
              status: InvoiceStatus.ISSUED,
              issuedAt: new Date(),
              items: {
                create: {
                  description: `${plan.name} initial monthly internet service — ${this.billing.billingPeriodLabel(issueDate)}`,
                  quantity: 1,
                  unitPriceCents: amounts.totalCents,
                  amountCents: amounts.totalCents,
                },
              },
            },
            include: planPurchaseInclude,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.findOpenPlanPurchase(customerId);
        if (existing) return existing;
      }
      throw error;
    }
  }

  private async createStripePlanSession(invoice: PlanPurchaseInvoice) {
    const existingPayment = invoice.payments[0];
    if (existingPayment?.providerSessionId) {
      const existingSession = await this.stripe.checkout.sessions.retrieve(
        existingPayment.providerSessionId,
      );
      if (existingSession.status === 'open' && existingSession.url) {
        return { checkoutUrl: existingSession.url, paymentId: existingPayment.id };
      }
    }
    if (!invoice.purchasePlan) {
      throw new BadRequestException('The selected plan is missing from the purchase invoice.');
    }

    const metadata = {
      checkoutKind: 'plan_purchase',
      invoiceId: invoice.id,
      customerId: invoice.customerId,
      planId: invoice.purchasePlan.id,
    };
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'payment',
        integration_identifier: `mero_telecom_plan_${this.randomLetters(8)}`,
        customer_email: invoice.customer.email,
        client_reference_id: invoice.id,
        metadata,
        payment_intent_data: { metadata },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: invoice.currency.toLowerCase(),
              unit_amount: invoice.totalCents,
              product_data: {
                name: `${invoice.purchasePlan.name} monthly internet plan`,
              },
            },
          },
        ],
        success_url: `${this.frontendUrl()}/customer/subscription?payment=success&sessionId={CHECKOUT_SESSION_ID}`,
        cancel_url: `${this.frontendUrl()}/customer/subscription?payment=cancelled`,
      },
      { idempotencyKey: `plan-checkout-${invoice.id}` },
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

  private utcDate(value: Date): Date {
    return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`);
  }
}
