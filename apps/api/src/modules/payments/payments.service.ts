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
  BillingMode,
  CheckoutApplicationStatus,
  CustomerStatus,
  InvoiceCollectionStatus,
  InvoiceStatus,
  InvoiceType,
  PaymentProvider,
  PaymentMethodType,
  PaymentStatus,
  Prisma,
  RecurringSetupAttemptStatus,
  Role,
  SubscriptionStatus,
  UserStatus,
} from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
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
import { AddressSelectionService } from '../coverage/address-selection.service';
import { normalizeAustralianStateCode } from '../coverage/australian-states';
import { CoverageService } from '../coverage/coverage.service';
import type { NormalizedAddressSuggestion } from '../coverage/coverage.types';
import { NotificationService } from '../notifications/notification.service';
import type { CreatePublicPlanCheckoutSessionDto } from './dto/create-checkout-session.dto';
import type { PaymentMethodSelectionDto } from './dto/create-checkout-session.dto';
import type { UpdatePaymentMethodDto } from './dto/create-checkout-session.dto';
import { StripeClientService } from './stripe-client.service';
import { PlanChangesService } from '../plan-changes/plan-changes.service';
import { PublicCheckoutContextService } from './public-checkout-context.service';
import { RefundsService } from '../refunds/refunds.service';
import { SubscriptionLifecycleService } from '../subscriptions/subscription-lifecycle.service';
import { AccountLedgerService } from '../account-ledger/account-ledger.service';

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
type RecurringSetupSubscription = Prisma.SubscriptionGetPayload<{
  include: { customer: true; plan: true };
}>;
type RecurringSetupAttemptRecord = Prisma.RecurringSetupAttemptGetPayload<Record<string, never>>;

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

interface RecurringCheckoutDetails {
  stripeSubscriptionId: string;
  stripeInvoiceId: string;
  stripePriceId: string;
  stripeStatus: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  paymentIntentId?: string;
  paymentMethodId: string;
  paymentMethodType?: PaymentMethodType;
  paymentMethodBrand?: string;
  paymentMethodLast4?: string;
  paymentMethodExpMonth?: number;
  paymentMethodExpYear?: number;
  hostedInvoiceUrl?: string;
  invoicePdfUrl?: string;
}

const protectedRecurringStatuses: SubscriptionStatus[] = [
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.PAST_DUE,
  SubscriptionStatus.SUSPENDED,
  SubscriptionStatus.CANCELLATION_PENDING,
  SubscriptionStatus.DISCONNECTION_PENDING,
];

@Injectable()
export class PaymentsService {
  private static readonly invoiceSequenceLock = BigInt(873201);
  private static readonly recurringSetupTtlMilliseconds = 60 * 60 * 1_000;
  private readonly logger = new Logger(PaymentsService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<AppConfig, true>,
    stripeClient: StripeClientService,
    private readonly dashboardCache: AdminDashboardCacheService,
    private readonly billing: BillingService,
    private readonly coverage: CoverageService,
    private readonly addressSelections: AddressSelectionService,
    private readonly publicCheckoutContext: PublicCheckoutContextService,
    private readonly invitations: AccountInvitationsService,
    private readonly notifications: NotificationService,
    private readonly planChanges: PlanChangesService,
    private readonly refunds: RefundsService,
    private readonly subscriptionLifecycle: SubscriptionLifecycleService,
    private readonly accountLedger: AccountLedgerService,
  ) {
    this.stripe = stripeClient.client;
  }

  async createPublicPlanCheckoutSession(
    input: CreatePublicPlanCheckoutSessionDto,
    checkoutContextToken?: string,
  ) {
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
    if (!plan.stripePriceId) {
      throw new BadRequestException('Automatic billing is not configured for this plan yet.');
    }
    if (existingUser || existingCustomer) {
      throw new ConflictException(
        'An account already exists for this email. Sign in to continue with your selected plan.',
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

    const trustedCheckout = await this.publicCheckoutContext.consume(
      checkoutContextToken,
      input.planId,
    );
    await this.coverage.assertTrustedAddressCanOrderPlan(
      trustedCheckout.trustedServiceAddress,
      input.planId,
    );
    const serviceAddress = this.normalizedAddress(trustedCheckout.trustedServiceAddress);
    const residentialAddress = input.residentialSameAsService
      ? serviceAddress
      : this.normalizedAddress(
          await this.addressSelections.consume(input.residentialAddressToken ?? ''),
        );
    const billingAddress = input.billingSameAsResidential
      ? residentialAddress
      : this.normalizedAddress(
          await this.addressSelections.consume(input.billingAddressToken ?? ''),
        );

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
          residentialAddress: this.addressJson(residentialAddress),
          serviceAddress: this.addressJson(serviceAddress),
          billingAddress: this.addressJson(billingAddress),
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
      paymentMethodType: input.paymentMethodType ?? PaymentMethodType.CARD,
    };
    try {
      const session = await this.stripe.checkout.sessions.create(
        {
          mode: 'subscription',
          integration_identifier: `mero_telecom_public_${this.randomLetters(8)}`,
          ...this.paymentMethodConfiguration(input.paymentMethodType ?? PaymentMethodType.CARD),
          customer_email: applicantEmail,
          client_reference_id: application.id,
          metadata,
          subscription_data: {
            metadata,
          },
          line_items: [
            {
              quantity: 1,
              price: plan.stripePriceId,
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

  async getRecurringSetupStatus(sessionId: string, actor: AuthenticatedUser) {
    if (!/^cs_(?:test|live)_/.test(sessionId)) {
      throw new BadRequestException('A valid Stripe Checkout Session ID is required.');
    }

    const session = await this.stripe.checkout.sessions.retrieve(sessionId);
    if (session.metadata?.checkoutKind !== 'enable_recurring') {
      throw new NotFoundException('Recurring setup status not found.');
    }

    const subscriptionId = session.metadata.existingSubscriptionId ?? session.client_reference_id;
    const attemptId = session.metadata.recurringSetupAttemptId;
    if (!subscriptionId || !attemptId) {
      throw new NotFoundException('Recurring setup status not found.');
    }

    const ownedSubscription = await this.prisma.subscription.findFirst({
      where: { id: subscriptionId, customer: { userId: actor.id } },
      select: {
        id: true,
        customer: { select: { stripeCustomerId: true } },
      },
    });
    if (
      !ownedSubscription?.customer.stripeCustomerId ||
      this.stripeId(session.customer) !== ownedSubscription.customer.stripeCustomerId
    ) {
      throw new NotFoundException('Recurring setup status not found.');
    }

    if (session.status === 'complete') {
      await this.processRecurringSetupEvent(
        {
          id: this.reconciliationEventId(session.id),
          type: 'checkout.session.completed',
        } as Stripe.Event,
        session,
      );
    }

    const subscription = await this.prisma.subscription.findUnique({
      where: { id: ownedSubscription.id },
      select: {
        id: true,
        billingMode: true,
        paymentMethodType: true,
        paymentMethodBrand: true,
        paymentMethodLast4: true,
        paymentMethodExpMonth: true,
        paymentMethodExpYear: true,
      },
    });
    if (!subscription) throw new NotFoundException('Recurring setup status not found.');
    const attempt = await this.prisma.recurringSetupAttempt.findFirst({
      where: {
        id: attemptId,
        subscriptionId: subscription.id,
        customerId: session.metadata.customerId,
      },
      select: { status: true, failureReason: true },
    });
    if (!attempt) throw new NotFoundException('Recurring setup status not found.');

    return {
      checkoutStatus: session.status,
      setupStatus:
        subscription.billingMode === BillingMode.STRIPE_RECURRING
          ? 'enabled'
          : session.status === 'expired' || attempt.status === RecurringSetupAttemptStatus.EXPIRED
            ? 'expired'
            : attempt.status === RecurringSetupAttemptStatus.FAILED ||
                attempt.status === RecurringSetupAttemptStatus.CANCELLED
              ? 'failed'
              : 'processing',
      setupMessage: attempt.failureReason,
      subscription,
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
    if (invoice.type === InvoiceType.STRIPE_RECURRING) {
      throw new BadRequestException(
        'Stripe manages payment collection for this recurring invoice. Update the saved payment method from My subscription.',
      );
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
    if (!plan.stripePriceId) {
      throw new BadRequestException('Automatic billing is not configured for this plan yet.');
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

  async createRecurringSetupSession(
    subscriptionId: string,
    actor: AuthenticatedUser,
    paymentMethodType: PaymentMethodType = PaymentMethodType.CARD,
    replacingClosedAttempt = false,
  ): Promise<{ checkoutUrl: string }> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { id: subscriptionId, customer: { userId: actor.id } },
      include: { customer: true, plan: true },
    });
    if (!subscription) throw new NotFoundException('Subscription not found.');
    if (subscription.status !== SubscriptionStatus.ACTIVE) {
      throw new BadRequestException('Only an active subscription can enable automatic payments.');
    }
    if (subscription.billingMode === BillingMode.STRIPE_RECURRING) {
      throw new ConflictException('Automatic recurring payments are already enabled.');
    }
    if (!subscription.plan.stripePriceId) {
      throw new BadRequestException('Automatic billing is not configured for this plan yet.');
    }
    if (subscription.currentPeriodEnd <= new Date()) {
      throw new ConflictException('The current billing period has ended. Refresh and try again.');
    }
    const outstanding = await this.prisma.invoice.count({
      where: {
        subscriptionId: subscription.id,
        status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.OVERDUE] },
      },
    });
    if (outstanding) {
      throw new ConflictException('Pay outstanding invoices before enabling automatic payments.');
    }

    let stripeCustomerId = subscription.customer.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await this.stripe.customers.create(
        {
          email: subscription.customer.email,
          name: `${subscription.customer.firstName} ${subscription.customer.lastName}`,
          metadata: { meroCustomerId: subscription.customerId },
        },
        { idempotencyKey: `recurring-customer-${subscription.customerId}` },
      );
      stripeCustomerId = customer.id;
      await this.prisma.customer.update({
        where: { id: subscription.customerId },
        data: { stripeCustomerId },
      });
    }

    const now = new Date();
    const attempt = await this.prisma.$transaction(
      async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${subscription.id}))`;
        const current = await transaction.subscription.findFirst({
          where: { id: subscription.id, customer: { userId: actor.id } },
          include: { customer: true, plan: true },
        });
        if (!current) throw new NotFoundException('Subscription not found.');
        const currentOutstanding = await transaction.invoice.count({
          where: {
            subscriptionId: current.id,
            status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.OVERDUE] },
          },
        });
        this.assertRecurringSetupEligible(current, currentOutstanding, now);
        await transaction.recurringSetupAttempt.updateMany({
          where: {
            subscriptionId: current.id,
            status: {
              in: [
                RecurringSetupAttemptStatus.PENDING,
                RecurringSetupAttemptStatus.CHECKOUT_CREATED,
                RecurringSetupAttemptStatus.PROCESSING,
              ],
            },
            expiresAt: { lte: now },
          },
          data: {
            status: RecurringSetupAttemptStatus.EXPIRED,
            failureReason: 'The automatic payment setup session expired.',
          },
        });
        let reusable = await transaction.recurringSetupAttempt.findFirst({
          where: {
            subscriptionId: current.id,
            status: {
              in: [
                RecurringSetupAttemptStatus.PENDING,
                RecurringSetupAttemptStatus.CHECKOUT_CREATED,
              ],
            },
            expiresAt: { gt: now },
          },
          orderBy: { createdAt: 'desc' },
        });
        if (
          reusable &&
          (reusable.paymentMethodType !== paymentMethodType ||
            reusable.expectedPlanId !== current.planId ||
            reusable.expectedStripePriceId !== current.plan.stripePriceId ||
            reusable.expectedCurrentPeriodStart.getTime() !==
              current.currentPeriodStart.getTime() ||
            reusable.expectedCurrentPeriodEnd.getTime() !== current.currentPeriodEnd.getTime() ||
            reusable.expectedSubscriptionUpdatedAt.getTime() !== current.updatedAt.getTime())
        ) {
          await transaction.recurringSetupAttempt.update({
            where: { id: reusable.id },
            data: {
              status: RecurringSetupAttemptStatus.CANCELLED,
              failureReason: 'The subscription or selected payment method changed.',
            },
          });
          reusable = null;
        }
        return (
          reusable ??
          transaction.recurringSetupAttempt.create({
            data: {
              subscriptionId: current.id,
              customerId: current.customerId,
              expectedPlanId: current.planId,
              expectedStripePriceId: current.plan.stripePriceId!,
              expectedCurrentPeriodStart: current.currentPeriodStart,
              expectedCurrentPeriodEnd: current.currentPeriodEnd,
              expectedSubscriptionUpdatedAt: current.updatedAt,
              paymentMethodType,
              expiresAt: new Date(now.getTime() + PaymentsService.recurringSetupTtlMilliseconds),
            },
          })
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (attempt.stripeCheckoutSessionId) {
      const existing = await this.stripe.checkout.sessions.retrieve(
        attempt.stripeCheckoutSessionId,
      );
      if (existing.status === 'open' && existing.url) return { checkoutUrl: existing.url };
      if (existing.status === 'complete') {
        return {
          checkoutUrl: `${this.frontendUrl()}/customer/subscription?recurring=enabled&sessionId=${encodeURIComponent(existing.id)}`,
        };
      }
      await this.prisma.recurringSetupAttempt.updateMany({
        where: {
          id: attempt.id,
          status: {
            in: [RecurringSetupAttemptStatus.PENDING, RecurringSetupAttemptStatus.CHECKOUT_CREATED],
          },
        },
        data: {
          status:
            existing.status === 'expired'
              ? RecurringSetupAttemptStatus.EXPIRED
              : RecurringSetupAttemptStatus.CANCELLED,
          failureReason: `Stripe Checkout session ${existing.status}.`,
        },
      });
      if (replacingClosedAttempt) {
        throw new ConflictException('Automatic payment setup could not be restarted. Try again.');
      }
      return this.createRecurringSetupSession(subscriptionId, actor, paymentMethodType, true);
    }
    const metadata = {
      checkoutKind: 'enable_recurring',
      recurringSetupAttemptId: attempt.id,
      existingSubscriptionId: subscription.id,
      customerId: subscription.customerId,
      planId: subscription.planId,
      paymentMethodType,
    };
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'setup',
        currency: 'aud',
        integration_identifier: `mero_telecom_recurring_${this.stableLetters(attempt.id)}`,
        ...this.paymentMethodConfiguration(paymentMethodType),
        customer: stripeCustomerId,
        client_reference_id: subscription.id,
        metadata,
        setup_intent_data: { metadata },
        expires_at: Math.floor(attempt.expiresAt.getTime() / 1_000),
        success_url: `${this.frontendUrl()}/customer/subscription?recurring=enabled&sessionId={CHECKOUT_SESSION_ID}`,
        cancel_url: `${this.frontendUrl()}/customer/subscription?recurring=cancelled`,
      },
      { idempotencyKey: `recurring-setup-${attempt.id}` },
    );
    if (!session.url) throw new BadRequestException('Stripe did not return a Checkout URL.');
    await this.prisma.recurringSetupAttempt.update({
      where: { id: attempt.id },
      data: {
        status: RecurringSetupAttemptStatus.CHECKOUT_CREATED,
        stripeCheckoutSessionId: session.id,
      },
    });
    return { checkoutUrl: session.url };
  }

  async createCustomerPortalSession(actor: AuthenticatedUser) {
    const customer = await this.prisma.customer.findUnique({ where: { userId: actor.id } });
    if (!customer?.stripeCustomerId) {
      throw new BadRequestException('Automatic billing has not been set up for this account.');
    }
    const returnUrl = `${this.frontendUrl()}/customer/subscription?paymentMethod=updated`;
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customer.stripeCustomerId,
      return_url: returnUrl,
      flow_data: {
        type: 'payment_method_update',
        after_completion: { type: 'redirect', redirect: { return_url: returnUrl } },
      },
      ...(this.configService.getOrThrow('stripe').portalConfigurationId
        ? { configuration: this.configService.getOrThrow('stripe').portalConfigurationId }
        : {}),
    });
    return { portalUrl: session.url };
  }

  async getPaymentMethods(actor: AuthenticatedUser) {
    const customer = await this.customerForActor(actor);
    if (!customer.stripeCustomerId) {
      return { paymentMethods: [], hasProtectedRecurringSubscription: false };
    }
    const [stripeCustomer, methods, protectedSubscriptionCount] = await Promise.all([
      this.stripe.customers.retrieve(customer.stripeCustomerId),
      this.stripe.paymentMethods.list({
        customer: customer.stripeCustomerId,
        limit: 100,
      }),
      this.prisma.subscription.count({
        where: {
          customerId: customer.id,
          billingMode: BillingMode.STRIPE_RECURRING,
          status: { in: protectedRecurringStatuses },
        },
      }),
    ]);
    if ('deleted' in stripeCustomer && stripeCustomer.deleted) {
      throw new BadRequestException('The Stripe customer for this account is no longer available.');
    }
    const defaultPaymentMethodId = this.stripeId(
      stripeCustomer.invoice_settings.default_payment_method,
    );
    const hasProtectedRecurringSubscription = protectedSubscriptionCount > 0;
    const now = new Date();
    return {
      paymentMethods: methods.data.map((method) => {
        const isDefault = method.id === defaultPaymentMethodId;
        const isExpired = method.card
          ? method.card.exp_year < now.getUTCFullYear() ||
            (method.card.exp_year === now.getUTCFullYear() &&
              method.card.exp_month < now.getUTCMonth() + 1)
          : false;
        const canRemove =
          !hasProtectedRecurringSubscription || (methods.data.length > 1 && !isDefault);
        return {
          id: method.id,
          type: method.type,
          brand: method.card?.brand ?? null,
          last4: method.card?.last4 ?? method.au_becs_debit?.last4 ?? null,
          expMonth: method.card?.exp_month ?? null,
          expYear: method.card?.exp_year ?? null,
          billingDetails: {
            name: method.billing_details?.name ?? null,
            email: method.billing_details?.email ?? null,
            phone: method.billing_details?.phone ?? null,
            address: {
              line1: method.billing_details?.address?.line1 ?? null,
              line2: method.billing_details?.address?.line2 ?? null,
              city: method.billing_details?.address?.city ?? null,
              state: method.billing_details?.address?.state ?? null,
              postalCode: method.billing_details?.address?.postal_code ?? null,
              country: method.billing_details?.address?.country ?? null,
            },
          },
          createdAt: method.created ? new Date(method.created * 1_000).toISOString() : null,
          isDefault,
          isExpired,
          canRemove,
          removalBlockedReason: canRemove
            ? null
            : methods.data.length === 1
              ? 'Add another payment method before removing this one. Your current payment method is being used for automatic subscription payments.'
              : 'Set another payment method as the default before removing this one.',
        };
      }),
      hasProtectedRecurringSubscription,
    };
  }

  async createPaymentMethodSetupSession(
    actor: AuthenticatedUser,
    input: PaymentMethodSelectionDto,
  ) {
    const customer = await this.ensureStripeCustomerForActor(actor);
    const operationId = randomUUID();
    const metadata = {
      checkoutKind: 'manage_payment_method',
      customerId: customer.id,
      actorUserId: actor.id,
      operationId,
      paymentMethodType: input.paymentMethodType ?? PaymentMethodType.CARD,
    };
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'setup',
        currency: 'aud',
        ...this.paymentMethodConfiguration(input.paymentMethodType ?? PaymentMethodType.CARD),
        customer: customer.stripeCustomerId!,
        client_reference_id: customer.id,
        metadata,
        setup_intent_data: { metadata },
        success_url: `${this.frontendUrl()}/customer/subscription?paymentMethod=added&sessionId={CHECKOUT_SESSION_ID}`,
        cancel_url: `${this.frontendUrl()}/customer/subscription?paymentMethod=cancelled`,
      },
      { idempotencyKey: `payment-method-setup-${customer.id}-${operationId}` },
    );
    if (!session.url) throw new BadRequestException('Stripe did not return a Checkout URL.');
    return { checkoutUrl: session.url };
  }

  async updatePaymentMethod(
    paymentMethodId: string,
    input: UpdatePaymentMethodDto,
    actor: AuthenticatedUser,
  ) {
    const customer = await this.customerForActor(actor);
    if (!customer.stripeCustomerId) {
      throw new BadRequestException('No Stripe payment methods are configured for this account.');
    }
    const receivedFields = Object.entries(input)
      .filter(([, value]) => value !== undefined)
      .map(([field]) => field);
    if (receivedFields.length === 0) {
      throw new BadRequestException('Provide at least one payment method detail to update.');
    }

    const paymentMethod = await this.ownedPaymentMethod(paymentMethodId, customer.stripeCustomerId);
    const update: Stripe.PaymentMethodUpdateParams = {};
    const billingDetails: NonNullable<Stripe.PaymentMethodUpdateParams['billing_details']> = {};
    const address: NonNullable<
      NonNullable<Stripe.PaymentMethodUpdateParams['billing_details']>['address']
    > = {};
    const clean = (value: string) => value.trim();

    if (input.billingName !== undefined) billingDetails.name = clean(input.billingName);
    if (input.billingEmail !== undefined) billingDetails.email = clean(input.billingEmail);
    if (input.billingPhone !== undefined) billingDetails.phone = clean(input.billingPhone);
    if (input.billingAddressLine1 !== undefined) {
      address.line1 = clean(input.billingAddressLine1);
    }
    if (input.billingAddressLine2 !== undefined) {
      address.line2 = clean(input.billingAddressLine2);
    }
    if (input.billingCity !== undefined) address.city = clean(input.billingCity);
    if (input.billingState !== undefined) address.state = clean(input.billingState);
    if (input.billingPostalCode !== undefined) {
      address.postal_code = clean(input.billingPostalCode);
    }
    if (input.billingCountry !== undefined) {
      address.country = clean(input.billingCountry).toUpperCase();
    }
    if (Object.keys(address).length > 0) billingDetails.address = address;
    if (Object.keys(billingDetails).length > 0) update.billing_details = billingDetails;

    if (input.cardExpMonth !== undefined || input.cardExpYear !== undefined) {
      if (!paymentMethod.card) {
        throw new BadRequestException('Expiry can only be updated for a card payment method.');
      }
      const expMonth = input.cardExpMonth ?? paymentMethod.card.exp_month;
      const expYear = input.cardExpYear ?? paymentMethod.card.exp_year;
      const now = new Date();
      if (
        expYear < now.getUTCFullYear() ||
        (expYear === now.getUTCFullYear() && expMonth < now.getUTCMonth() + 1)
      ) {
        throw new BadRequestException('Card expiry must be in the future.');
      }
      if (expYear > now.getUTCFullYear() + 50) {
        throw new BadRequestException('Card expiry year is too far in the future.');
      }
      update.card = { exp_month: expMonth, exp_year: expYear };
    }

    const operationId = randomUUID();
    const updatedPaymentMethod = await this.stripe.paymentMethods.update(paymentMethod.id, update, {
      idempotencyKey: `payment-method-details-${customer.id}-${operationId}`,
    });
    await this.prisma.$transaction(async (transaction) => {
      await transaction.subscription.updateMany({
        where: { customerId: customer.id, stripePaymentMethodId: paymentMethod.id },
        data: {
          paymentMethodBrand: updatedPaymentMethod.card?.brand ?? null,
          paymentMethodLast4: this.paymentMethodLast4(updatedPaymentMethod),
          paymentMethodExpMonth: updatedPaymentMethod.card?.exp_month ?? null,
          paymentMethodExpYear: updatedPaymentMethod.card?.exp_year ?? null,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: 'PAYMENT_METHOD_DETAILS_UPDATED',
          entityType: 'Customer',
          entityId: customer.id,
          metadata: {
            type: this.localPaymentMethodType(updatedPaymentMethod),
            brand: updatedPaymentMethod.card?.brand ?? null,
            last4: this.paymentMethodLast4(updatedPaymentMethod),
            fields: receivedFields,
            operationId,
          },
        },
      });
    });
    await this.dashboardCache.invalidate();
    return { updated: true };
  }

  async setDefaultPaymentMethod(paymentMethodId: string, actor: AuthenticatedUser) {
    const customer = await this.customerForActor(actor);
    if (!customer.stripeCustomerId) {
      throw new BadRequestException('No Stripe payment methods are configured for this account.');
    }
    const paymentMethod = await this.ownedPaymentMethod(paymentMethodId, customer.stripeCustomerId);
    this.assertUsablePaymentMethod(paymentMethod);
    const subscriptions = await this.protectedRecurringSubscriptions(customer.id);
    const operationId = randomUUID();
    await this.stripe.customers.update(
      customer.stripeCustomerId,
      { invoice_settings: { default_payment_method: paymentMethod.id } },
      { idempotencyKey: `payment-method-default-customer-${customer.id}-${operationId}` },
    );
    await Promise.all(
      subscriptions
        .filter((subscription) => subscription.stripeSubscriptionId)
        .map((subscription) =>
          this.stripe.subscriptions.update(
            subscription.stripeSubscriptionId!,
            { default_payment_method: paymentMethod.id },
            {
              idempotencyKey: `payment-method-default-subscription-${subscription.id}-${operationId}`,
            },
          ),
        ),
    );
    await this.persistDefaultPaymentMethod({
      customerId: customer.id,
      actorUserId: actor.id,
      paymentMethod,
      action: 'DEFAULT_PAYMENT_METHOD_CHANGED',
      entityId: customer.id,
      operationId,
    });
    await this.retryOutstandingStripeInvoices(customer.id, paymentMethod.id, operationId);
    await this.dashboardCache.invalidate();
    return { updated: true };
  }

  async removePaymentMethod(paymentMethodId: string, actor: AuthenticatedUser) {
    const customer = await this.customerForActor(actor);
    if (!customer.stripeCustomerId) {
      throw new BadRequestException('No Stripe payment methods are configured for this account.');
    }
    const [paymentMethod, methods, stripeCustomer, subscriptions] = await Promise.all([
      this.ownedPaymentMethod(paymentMethodId, customer.stripeCustomerId),
      this.stripe.paymentMethods.list({
        customer: customer.stripeCustomerId,
        limit: 100,
      }),
      this.stripe.customers.retrieve(customer.stripeCustomerId),
      this.protectedRecurringSubscriptions(customer.id),
    ]);
    if ('deleted' in stripeCustomer && stripeCustomer.deleted) {
      throw new BadRequestException('The Stripe customer for this account is no longer available.');
    }
    const isDefault =
      this.stripeId(stripeCustomer.invoice_settings.default_payment_method) === paymentMethod.id;
    if (subscriptions.length > 0 && methods.data.length <= 1) {
      throw new ConflictException(
        'Add another payment method before removing this one. Your current payment method is being used for automatic subscription payments.',
      );
    }
    if (subscriptions.length > 0 && isDefault) {
      throw new ConflictException(
        'Set another payment method as the default before removing this one.',
      );
    }
    const operationId = randomUUID();
    if (isDefault) {
      await this.stripe.customers.update(
        customer.stripeCustomerId,
        { invoice_settings: { default_payment_method: '' } },
        { idempotencyKey: `payment-method-clear-default-${customer.id}-${operationId}` },
      );
    }
    await this.stripe.paymentMethods.detach(
      paymentMethod.id,
      {},
      { idempotencyKey: `payment-method-detach-${customer.id}-${operationId}` },
    );
    await this.prisma.$transaction(async (transaction) => {
      await transaction.subscription.updateMany({
        where: { customerId: customer.id, stripePaymentMethodId: paymentMethod.id },
        data: {
          stripePaymentMethodId: null,
          paymentMethodType: null,
          paymentMethodBrand: null,
          paymentMethodLast4: null,
          paymentMethodExpMonth: null,
          paymentMethodExpYear: null,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: 'PAYMENT_METHOD_REMOVED',
          entityType: 'Customer',
          entityId: customer.id,
          metadata: {
            type: this.localPaymentMethodType(paymentMethod),
            brand: paymentMethod.card?.brand ?? null,
            last4: this.paymentMethodLast4(paymentMethod),
            operationId,
          },
        },
      });
    });
    await this.dashboardCache.invalidate();
    return { removed: true };
  }

  async processStripeWebhook(payload: Buffer, signature: string | undefined): Promise<void> {
    const event = this.constructStripeWebhookEvent(payload, signature);
    await this.processStripeEvent(event);
  }

  constructStripeWebhookEvent(payload: Buffer, signature: string | undefined): Stripe.Event {
    if (!signature) throw new BadRequestException('Missing Stripe webhook signature.');
    try {
      return this.stripe.webhooks.constructEvent(payload, signature, this.webhookSecret());
    } catch {
      this.logger.warn(
        JSON.stringify({ event: 'stripe.webhook.rejected', reason: 'invalid_signature' }),
      );
      throw new BadRequestException('Invalid Stripe webhook signature.');
    }
  }

  async processStripeEvent(event: Stripe.Event): Promise<void> {
    this.logger.log(
      JSON.stringify({ event: 'stripe.webhook.received', eventId: event.id, type: event.type }),
    );
    if (
      event.type === 'refund.created' ||
      event.type === 'refund.updated' ||
      event.type === 'refund.failed'
    ) {
      await this.refunds.processStripeEvent(event);
      return;
    }
    if (event.type === 'invoice.finalized') {
      await this.ensureStripeRecurringInvoice(event.data.object, InvoiceStatus.ISSUED);
      return;
    }
    if (event.type === 'invoice.updated') {
      await this.processStripeInvoiceRetryState(event);
      return;
    }
    if (
      event.type === 'payment_intent.processing' ||
      event.type === 'payment_intent.payment_failed'
    ) {
      await this.processStripePaymentIntentState(event);
      return;
    }
    if (event.type === 'invoice.payment_failed') {
      await this.processStripeInvoiceFailure(event);
      return;
    }
    if (event.type === 'invoice.payment_action_required') {
      await this.processStripeInvoiceActionRequired(event);
      return;
    }
    if (event.type === 'invoice.paid') {
      await this.processStripeInvoicePaid(event);
      return;
    }
    if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      await this.processStripeSubscriptionEvent(event);
      return;
    }
    if (event.type === 'customer.updated') {
      await this.processStripeCustomerUpdated(event);
      return;
    }
    if (
      event.type === 'payment_method.attached' ||
      event.type === 'payment_method.updated' ||
      event.type === 'payment_method.detached'
    ) {
      await this.processStripePaymentMethodEvent(event);
      return;
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
    if (session.metadata?.checkoutKind === 'enable_recurring') {
      await this.processRecurringSetupEvent(event, session);
      return;
    }
    if (session.metadata?.checkoutKind === 'manage_payment_method') {
      await this.processPaymentMethodSetupEvent(event, session);
      return;
    }
    if (event.type === 'checkout.session.async_payment_failed') {
      const invoiceId = session.metadata?.invoiceId ?? session.client_reference_id;
      if (!invoiceId) {
        throw new BadRequestException('Stripe Checkout session is missing an invoice reference.');
      }
      await this.subscriptionLifecycle.handlePaymentFailure({
        providerEventId: event.id,
        eventType: event.type,
        invoiceId,
        providerSessionId: session.id,
        expectedCustomerId: session.metadata?.customerId,
        expectedAmountCents: session.amount_total ?? undefined,
        expectedCurrency: session.currency ?? undefined,
      });
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
    const recurring =
      session.metadata?.checkoutKind === 'plan_purchase'
        ? await this.loadRecurringCheckoutDetails(session)
        : null;
    if (recurring) {
      await this.synchronizeInitialRecurringPaymentMethod(session, recurring, providerEventId);
    }

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
          let activatedAt: Date | undefined;
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
                status: {
                  in: [
                    SubscriptionStatus.ACTIVE,
                    SubscriptionStatus.PAST_DUE,
                    SubscriptionStatus.SUSPENDED,
                    SubscriptionStatus.CANCELLATION_PENDING,
                    SubscriptionStatus.DISCONNECTION_PENDING,
                  ],
                },
              },
            });
            if (currentSubscription) {
              throw new ConflictException('The customer already has a current subscription.');
            }
            activatedAt = new Date();
            const billingAnchorDay = activatedAt.getUTCDate();
            const subscription = await transaction.subscription.create({
              data: {
                customerId: invoice.customerId,
                planId: invoice.purchasePlanId,
                monthlyCents: invoice.totalCents,
                status: SubscriptionStatus.ACTIVE,
                startDate: this.utcDate(activatedAt),
                billingAnchorDay,
                billingMode: BillingMode.STRIPE_RECURRING,
                stripeSubscriptionId: recurring?.stripeSubscriptionId,
                stripePriceId: recurring?.stripePriceId,
                stripeStatus: recurring?.stripeStatus,
                stripePaymentMethodId: recurring?.paymentMethodId,
                paymentMethodType: recurring?.paymentMethodType,
                paymentMethodBrand: recurring?.paymentMethodBrand,
                paymentMethodLast4: recurring?.paymentMethodLast4,
                paymentMethodExpMonth: recurring?.paymentMethodExpMonth,
                paymentMethodExpYear: recurring?.paymentMethodExpYear,
                cancelAtPeriodEnd: recurring?.cancelAtPeriodEnd ?? false,
                currentPeriodStart: recurring?.currentPeriodStart ?? activatedAt,
                currentPeriodEnd:
                  recurring?.currentPeriodEnd ??
                  this.billing.nextMonthlyBoundary(activatedAt, billingAnchorDay),
                nextBillingAt: recurring?.currentPeriodEnd,
              },
            });
            activatedSubscriptionId = subscription.id;
          }
          const paymentIntentId =
            recurring?.paymentIntentId ?? this.stripeId(session.payment_intent);
          const payment = await transaction.payment.update({
            where: { id: paymentForSession.id },
            data: {
              providerPaymentId: paymentIntentId,
              status: PaymentStatus.SUCCEEDED,
              paidAt: new Date(),
            },
          });
          const invoiceBillingPeriod =
            activatedAt && recurring
              ? {
                  start: this.utcDate(recurring.currentPeriodStart),
                  end: this.utcDate(new Date(recurring.currentPeriodEnd.getTime() - 1)),
                }
              : activatedAt
                ? this.billing.billingPeriodFor(activatedAt)
                : null;
          await transaction.invoice.update({
            where: { id: invoice.id },
            data: {
              status: InvoiceStatus.PAID,
              paidAt: new Date(),
              ...(activatedSubscriptionId && invoiceBillingPeriod
                ? {
                    subscriptionId: activatedSubscriptionId,
                    billingPeriodStart: invoiceBillingPeriod.start,
                    billingPeriodEnd: invoiceBillingPeriod.end,
                    type: InvoiceType.STRIPE_RECURRING,
                    stripeInvoiceId: recurring?.stripeInvoiceId,
                    stripeHostedUrl: recurring?.hostedInvoiceUrl,
                    stripePdfUrl: recurring?.invoicePdfUrl,
                  }
                : {}),
            },
          });
          const stripeCustomerId = this.stripeId(session.customer);
          if (stripeCustomerId) {
            await transaction.customer.updateMany({
              where: { id: invoice.customerId, stripeCustomerId: null },
              data: { stripeCustomerId },
            });
          }
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
    await this.subscriptionLifecycle.handleConfirmedPayment(invoiceId);
  }

  private async processStripeInvoiceFailure(
    event: Stripe.InvoicePaymentFailedEvent,
  ): Promise<void> {
    const stripeInvoice = event.data.object;
    const invoiceId = await this.ensureStripeRecurringInvoice(stripeInvoice, InvoiceStatus.ISSUED);
    if (!invoiceId) return;
    const failure = await this.stripeInvoicePaymentFailure(stripeInvoice);
    await this.subscriptionLifecycle.handlePaymentFailure({
      providerEventId: event.id,
      eventType: event.type,
      invoiceId,
      expectedCustomerId: undefined,
      expectedAmountCents: stripeInvoice.amount_due,
      expectedCurrency: stripeInvoice.currency,
      providerPaymentId: this.invoicePaymentIntentId(stripeInvoice),
      failedAt: new Date(event.created * 1_000),
      attemptCount: stripeInvoice.attempt_count,
      nextPaymentAttempt: stripeInvoice.next_payment_attempt
        ? new Date(stripeInvoice.next_payment_attempt * 1_000)
        : undefined,
      collectionStatus: stripeInvoice.next_payment_attempt
        ? InvoiceCollectionStatus.RETRYING
        : InvoiceCollectionStatus.PAYMENT_METHOD_REQUIRED,
      paymentErrorCode: failure.code,
    });
  }

  private async processStripeInvoiceActionRequired(event: Stripe.Event): Promise<void> {
    const stripeInvoice = event.data.object as Stripe.Invoice;
    const invoiceId = await this.ensureStripeRecurringInvoice(stripeInvoice, InvoiceStatus.ISSUED);
    if (!invoiceId) return;
    const failure = await this.stripeInvoicePaymentFailure(stripeInvoice);
    await this.subscriptionLifecycle.handlePaymentActionRequired({
      providerEventId: event.id,
      eventType: event.type,
      invoiceId,
      expectedAmountCents: stripeInvoice.amount_due,
      expectedCurrency: stripeInvoice.currency,
      providerPaymentId: this.invoicePaymentIntentId(stripeInvoice),
      failedAt: new Date(event.created * 1_000),
      attemptCount: stripeInvoice.attempt_count,
      nextPaymentAttempt: stripeInvoice.next_payment_attempt
        ? new Date(stripeInvoice.next_payment_attempt * 1_000)
        : undefined,
      collectionStatus: InvoiceCollectionStatus.ACTION_REQUIRED,
      paymentErrorCode: failure.code,
      hostedInvoiceUrl: stripeInvoice.hosted_invoice_url ?? undefined,
    });
  }

  private async processStripeInvoiceRetryState(event: Stripe.Event): Promise<void> {
    const stripeInvoice = event.data.object as Stripe.Invoice;
    const invoiceId = await this.ensureStripeRecurringInvoice(stripeInvoice, InvoiceStatus.ISSUED);
    if (!invoiceId) return;
    try {
      await this.prisma.$transaction(async (transaction) => {
        if (
          await transaction.paymentWebhookEvent.findUnique({
            where: { providerEventId: event.id },
          })
        ) {
          return;
        }
        const invoice = await transaction.invoice.findUnique({ where: { id: invoiceId } });
        if (!invoice) return;
        const nextPaymentAttempt = stripeInvoice.next_payment_attempt
          ? new Date(stripeInvoice.next_payment_attempt * 1_000)
          : null;
        await transaction.invoice.update({
          where: { id: invoice.id },
          data: {
            stripeAttemptCount: stripeInvoice.attempt_count,
            stripeNextPaymentAttempt: nextPaymentAttempt,
            collectionStatus:
              invoice.status === InvoiceStatus.PAID
                ? InvoiceCollectionStatus.NONE
                : nextPaymentAttempt
                  ? stripeInvoice.attempt_count > 0
                    ? InvoiceCollectionStatus.RETRYING
                    : InvoiceCollectionStatus.SCHEDULED
                  : invoice.collectionStatus,
          },
        });
        await transaction.paymentWebhookEvent.create({
          data: {
            provider: PaymentProvider.STRIPE,
            providerEventId: event.id,
            eventType: event.type,
          },
        });
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const stored = await this.prisma.paymentWebhookEvent.findUnique({
          where: { providerEventId: event.id },
        });
        if (stored) return;
      }
      throw error;
    }
  }

  private async processStripeInvoicePaid(event: Stripe.InvoicePaidEvent): Promise<void> {
    const stripeInvoice = event.data.object;
    const invoiceId = await this.ensureStripeRecurringInvoice(stripeInvoice, InvoiceStatus.PAID);
    if (!invoiceId) return;
    try {
      await this.prisma.$transaction(
        async (transaction) => {
          if (
            await transaction.paymentWebhookEvent.findUnique({
              where: { providerEventId: event.id },
            })
          ) {
            return;
          }
          const invoice = await transaction.invoice.findUnique({
            where: { id: invoiceId },
            include: {
              subscription: {
                select: {
                  paymentMethodType: true,
                  paymentMethodBrand: true,
                  paymentMethodLast4: true,
                },
              },
            },
          });
          if (
            !invoice ||
            !invoice.subscriptionId ||
            invoice.currency !== stripeInvoice.currency.toUpperCase()
          ) {
            throw new BadRequestException(
              'Stripe invoice payment does not match a Mero Telecom subscription invoice.',
            );
          }
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${invoice.subscriptionId}))`;
          const payment =
            stripeInvoice.amount_paid > 0
              ? await transaction.payment.upsert({
                  where: {
                    provider_providerPaymentId: {
                      provider: PaymentProvider.STRIPE,
                      providerPaymentId:
                        this.invoicePaymentIntentId(stripeInvoice) ??
                        `stripe-invoice:${stripeInvoice.id}`,
                    },
                  },
                  create: {
                    invoiceId: invoice.id,
                    customerId: invoice.customerId,
                    provider: PaymentProvider.STRIPE,
                    providerPaymentId:
                      this.invoicePaymentIntentId(stripeInvoice) ??
                      `stripe-invoice:${stripeInvoice.id}`,
                    amountCents: stripeInvoice.amount_paid,
                    currency: invoice.currency,
                    status: PaymentStatus.SUCCEEDED,
                    paymentMethodType: invoice.subscription?.paymentMethodType,
                    paymentMethodBrand: invoice.subscription?.paymentMethodBrand,
                    paymentMethodLast4: invoice.subscription?.paymentMethodLast4,
                    paidAt: new Date(event.created * 1_000),
                  },
                  update: {
                    status: PaymentStatus.SUCCEEDED,
                    paidAt: new Date(event.created * 1_000),
                  },
                })
              : null;
          await transaction.invoice.update({
            where: { id: invoice.id },
            data: {
              status: InvoiceStatus.PAID,
              paidAt: new Date(event.created * 1_000),
              stripeHostedUrl: stripeInvoice.hosted_invoice_url,
              stripePdfUrl: stripeInvoice.invoice_pdf,
              collectionStatus: InvoiceCollectionStatus.NONE,
              stripeAttemptCount: stripeInvoice.attempt_count,
              stripeNextPaymentAttempt: null,
              stripeLastPaymentErrorCode: null,
              paymentActionRequiredAt: null,
            },
          });
          await transaction.auditLog.create({
            data: {
              action: payment ? 'AUTOMATIC_PAYMENT_SUCCEEDED' : 'INVOICE_SETTLED_BY_ACCOUNT_CREDIT',
              entityType: payment ? 'Payment' : 'Invoice',
              entityId: payment?.id ?? invoice.id,
              metadata: {
                invoiceId: invoice.id,
                stripeInvoiceId: stripeInvoice.id,
                amountCents: stripeInvoice.amount_paid,
              },
            },
          });
          await transaction.paymentWebhookEvent.create({
            data: {
              provider: PaymentProvider.STRIPE,
              providerEventId: event.id,
              eventType: event.type,
              paymentId: payment?.id,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const stored = await this.prisma.paymentWebhookEvent.findUnique({
          where: { providerEventId: event.id },
        });
        if (stored) return;
      }
      throw error;
    }
    await this.subscriptionLifecycle.handleConfirmedPayment(invoiceId);
    await this.dashboardCache.invalidate();
  }

  private async ensureStripeRecurringInvoice(
    stripeInvoice: Stripe.Invoice,
    status: InvoiceStatus,
  ): Promise<string | null> {
    const stripeSubscriptionId = this.stripeSubscriptionIdFromInvoice(stripeInvoice);
    if (!stripeSubscriptionId) return null;
    const subscription = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId },
      include: { customer: true, plan: true },
    });
    if (!subscription) {
      throw new ConflictException('The local Stripe subscription is not ready for its invoice.');
    }
    const stripeCustomerId = this.stripeId(stripeInvoice.customer);
    if (
      subscription.billingMode !== BillingMode.STRIPE_RECURRING ||
      (stripeCustomerId && subscription.customer.stripeCustomerId !== stripeCustomerId) ||
      stripeInvoice.currency.toUpperCase() !== 'AUD'
    ) {
      throw new BadRequestException('Stripe recurring invoice does not match the subscription.');
    }
    const existing = await this.prisma.invoice.findUnique({
      where: { stripeInvoiceId: stripeInvoice.id },
      select: { id: true },
    });
    if (existing) return existing.id;

    const issueAt = new Date(stripeInvoice.created * 1_000);
    const periodStart = this.utcDate(new Date(stripeInvoice.period_start * 1_000));
    const periodEnd = this.utcDate(new Date(stripeInvoice.period_end * 1_000 - 1));
    const isPlanChangeInvoice = stripeInvoice.billing_reason === 'subscription_update';
    const stripeInvoiceTotalCents = Math.max(0, stripeInvoice.total);
    const totalCents = Math.max(0, stripeInvoice.amount_due);
    const creditAppliedCents = Math.max(0, stripeInvoiceTotalCents - totalCents);
    const debitAppliedCents = Math.max(0, totalCents - stripeInvoiceTotalCents);
    const amounts =
      totalCents === 0
        ? { subtotalCents: 0, taxCents: 0, totalCents: 0 }
        : this.billing.calculateGstInclusiveAmounts(totalCents);
    try {
      const created = await this.prisma.$transaction(
        async (transaction) => {
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${subscription.id}))`;
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(${PaymentsService.invoiceSequenceLock})`;
          const alreadyExists = await transaction.invoice.findUnique({
            where: { stripeInvoiceId: stripeInvoice.id },
            select: { id: true },
          });
          if (alreadyExists) return alreadyExists;
          const issueDate = this.utcDate(issueAt);
          const invoiceNumber = await this.nextInvoiceNumber(transaction, issueDate);
          const baseDescription = isPlanChangeInvoice
            ? `${subscription.plan.name} Stripe plan-change adjustment`
            : `${subscription.plan.name} automatic monthly internet service`;
          const items = [
            {
              description: baseDescription,
              quantity: 1,
              unitPriceCents: stripeInvoiceTotalCents,
              amountCents: stripeInvoiceTotalCents,
            },
            ...(creditAppliedCents > 0
              ? [
                  {
                    description: 'Account credit applied by Stripe',
                    quantity: 1,
                    unitPriceCents: -creditAppliedCents,
                    amountCents: -creditAppliedCents,
                  },
                ]
              : []),
            ...(debitAppliedCents > 0
              ? [
                  {
                    description: 'Account debit adjustment applied by Stripe',
                    quantity: 1,
                    unitPriceCents: debitAppliedCents,
                    amountCents: debitAppliedCents,
                  },
                ]
              : []),
          ];
          const invoice = await transaction.invoice.create({
            data: {
              invoiceNumber,
              customerId: subscription.customerId,
              subscriptionId: subscription.id,
              type: isPlanChangeInvoice ? InvoiceType.PLAN_CHANGE : InvoiceType.STRIPE_RECURRING,
              stripeInvoiceId: stripeInvoice.id,
              stripeHostedUrl: stripeInvoice.hosted_invoice_url,
              stripePdfUrl: stripeInvoice.invoice_pdf,
              issueDate,
              dueDate: stripeInvoice.due_date
                ? this.utcDate(new Date(stripeInvoice.due_date * 1_000))
                : issueDate,
              billingPeriodStart: isPlanChangeInvoice ? null : periodStart,
              billingPeriodEnd: isPlanChangeInvoice ? null : periodEnd,
              ...amounts,
              currency: stripeInvoice.currency.toUpperCase(),
              status,
              issuedAt: issueAt,
              paidAt: status === InvoiceStatus.PAID ? issueAt : null,
              items: {
                create: items,
              },
            },
          });
          if (creditAppliedCents > 0) {
            const application = await this.accountLedger.recordStripeInvoiceApplication(
              transaction,
              {
                customerId: subscription.customerId,
                invoiceId: invoice.id,
                stripeInvoiceId: stripeInvoice.id,
                creditAppliedCents,
              },
            );
            if (application.unallocatedCents > 0) {
              await transaction.auditLog.create({
                data: {
                  action: 'STRIPE_CREDIT_APPLICATION_REQUIRES_REVIEW',
                  entityType: 'Invoice',
                  entityId: invoice.id,
                  metadata: {
                    stripeInvoiceId: stripeInvoice.id,
                    stripeCreditAppliedCents: creditAppliedCents,
                    unallocatedCents: application.unallocatedCents,
                  },
                },
              });
            }
          }
          if (debitAppliedCents > 0) {
            const application = await this.accountLedger.recordStripeInvoiceDebitApplication(
              transaction,
              {
                customerId: subscription.customerId,
                invoiceId: invoice.id,
                stripeInvoiceId: stripeInvoice.id,
                debitAppliedCents,
              },
            );
            if (application.unallocatedCents > 0) {
              await transaction.auditLog.create({
                data: {
                  action: 'STRIPE_DEBIT_APPLICATION_REQUIRES_REVIEW',
                  entityType: 'Invoice',
                  entityId: invoice.id,
                  metadata: {
                    stripeInvoiceId: stripeInvoice.id,
                    stripeDebitAppliedCents: debitAppliedCents,
                    unallocatedCents: application.unallocatedCents,
                  },
                },
              });
            }
          }
          if (totalCents > 0) {
            const providerPaymentId =
              this.invoicePaymentIntentId(stripeInvoice) ?? `stripe-invoice:${stripeInvoice.id}`;
            await transaction.payment.upsert({
              where: {
                provider_providerPaymentId: {
                  provider: PaymentProvider.STRIPE,
                  providerPaymentId,
                },
              },
              create: {
                invoiceId: invoice.id,
                customerId: subscription.customerId,
                provider: PaymentProvider.STRIPE,
                providerPaymentId,
                amountCents:
                  status === InvoiceStatus.PAID
                    ? stripeInvoice.amount_paid
                    : stripeInvoice.amount_due,
                currency: stripeInvoice.currency.toUpperCase(),
                status:
                  status === InvoiceStatus.PAID ? PaymentStatus.SUCCEEDED : PaymentStatus.PENDING,
                paymentMethodType: subscription.paymentMethodType,
                paymentMethodBrand: subscription.paymentMethodBrand,
                paymentMethodLast4: subscription.paymentMethodLast4,
                paidAt: status === InvoiceStatus.PAID ? issueAt : null,
              },
              update: {},
            });
          }
          return { id: invoice.id };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return created.id;
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const duplicate = await this.prisma.invoice.findFirst({
          where: {
            OR: [
              { stripeInvoiceId: stripeInvoice.id },
              ...(isPlanChangeInvoice
                ? []
                : [
                    {
                      subscriptionId: subscription.id,
                      billingPeriodStart: periodStart,
                      billingPeriodEnd: periodEnd,
                    },
                  ]),
            ],
          },
          select: { id: true },
        });
        if (duplicate) return duplicate.id;
      }
      throw error;
    }
  }

  private async processStripeSubscriptionEvent(event: Stripe.Event): Promise<void> {
    const eventSubscription = event.data.object as Stripe.Subscription;
    const stripeSubscription =
      event.type === 'customer.subscription.deleted'
        ? eventSubscription
        : await this.stripe.subscriptions.retrieve(eventSubscription.id, {
            expand: ['default_payment_method'],
          });
    const local = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: stripeSubscription.id },
    });
    // Stripe doesn't guarantee event ordering. Retrying this queued event lets
    // the Checkout/setup completion establish the local subscription first.
    if (!local) {
      const attemptId = stripeSubscription.metadata?.recurringSetupAttemptId;
      const attempt = attemptId
        ? await this.prisma.recurringSetupAttempt.findUnique({ where: { id: attemptId } })
        : null;
      if (
        attempt &&
        (attempt.status === RecurringSetupAttemptStatus.FAILED ||
          attempt.status === RecurringSetupAttemptStatus.CANCELLED ||
          attempt.status === RecurringSetupAttemptStatus.EXPIRED)
      ) {
        try {
          await this.prisma.paymentWebhookEvent.create({
            data: {
              provider: PaymentProvider.STRIPE,
              providerEventId: event.id,
              eventType: event.type,
            },
          });
        } catch (error: unknown) {
          if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
            throw error;
          }
        }
        return;
      }
      throw new ConflictException('The local Stripe subscription is not ready to synchronize.');
    }
    const item = stripeSubscription.items.data[0];
    if (!item) throw new BadRequestException('Stripe subscription has no price item.');
    const paymentMethod = await this.resolvePaymentMethod(
      stripeSubscription.default_payment_method,
    );
    const periodStart = new Date(item.current_period_start * 1_000);
    const periodEnd = new Date(item.current_period_end * 1_000);
    const stripeEnded =
      event.type === 'customer.subscription.deleted' || stripeSubscription.status === 'canceled';
    await this.prisma.$transaction(async (transaction) => {
      if (
        await transaction.paymentWebhookEvent.findUnique({ where: { providerEventId: event.id } })
      ) {
        return;
      }
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${local.id}))`;
      const current = await transaction.subscription.findUnique({ where: { id: local.id } });
      if (!current) return;
      const cancellationInProgress =
        current.status === SubscriptionStatus.CANCELLATION_PENDING ||
        current.status === SubscriptionStatus.DISCONNECTION_PENDING;
      const status = stripeEnded
        ? cancellationInProgress
          ? current.status
          : SubscriptionStatus.CANCELLED
        : stripeSubscription.status === 'past_due' || stripeSubscription.status === 'unpaid'
          ? current.status === SubscriptionStatus.ACTIVE
            ? SubscriptionStatus.PAST_DUE
            : current.status
          : stripeSubscription.status === 'active' || stripeSubscription.status === 'trialing'
            ? current.status === SubscriptionStatus.PAST_DUE
              ? SubscriptionStatus.ACTIVE
              : current.status
            : current.status;
      await transaction.subscription.update({
        where: { id: current.id },
        data: {
          stripeStatus: stripeSubscription.status,
          stripePriceId: item.price.id,
          stripePaymentMethodId: paymentMethod?.id,
          paymentMethodType: paymentMethod ? this.localPaymentMethodType(paymentMethod) : null,
          paymentMethodBrand: paymentMethod?.card?.brand,
          paymentMethodLast4: paymentMethod ? this.paymentMethodLast4(paymentMethod) : null,
          paymentMethodExpMonth: paymentMethod?.card?.exp_month,
          paymentMethodExpYear: paymentMethod?.card?.exp_year,
          cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          nextBillingAt: stripeEnded || stripeSubscription.cancel_at_period_end ? null : periodEnd,
          status,
          ...(stripeEnded && !cancellationInProgress
            ? {
                endDate: this.utcDate(new Date(event.created * 1_000)),
                endReason: 'STRIPE_SUBSCRIPTION_ENDED',
              }
            : {}),
        },
      });
      if (!stripeSubscription.pending_update) {
        const pendingUpgrade = await transaction.planChangeRequest.findFirst({
          where: {
            sourceSubscriptionId: current.id,
            type: 'UPGRADE',
            status: 'PROCESSING',
            targetPlan: { stripePriceId: item.price.id },
          },
          include: { targetPlan: true },
        });
        if (pendingUpgrade) {
          await transaction.subscription.update({
            where: { id: current.id },
            data: {
              planId: pendingUpgrade.targetPlanId,
              monthlyCents: pendingUpgrade.targetPlanPriceCents,
              stripePriceId: item.price.id,
            },
          });
          await transaction.planChangeRequest.update({
            where: { id: pendingUpgrade.id },
            data: {
              status: 'APPLIED',
              appliedAt: new Date(event.created * 1_000),
              effectiveAt: new Date(event.created * 1_000),
            },
          });
          await transaction.auditLog.create({
            data: {
              action: 'STRIPE_PLAN_UPGRADE_APPLIED',
              entityType: 'PlanChangeRequest',
              entityId: pendingUpgrade.id,
              metadata: { stripeSubscriptionId: stripeSubscription.id },
            },
          });
        }
      }
      await transaction.paymentWebhookEvent.create({
        data: {
          provider: PaymentProvider.STRIPE,
          providerEventId: event.id,
          eventType: event.type,
        },
      });
      await transaction.auditLog.create({
        data: {
          action: stripeEnded ? 'STRIPE_SUBSCRIPTION_ENDED' : 'STRIPE_SUBSCRIPTION_SYNCHRONIZED',
          entityType: 'Subscription',
          entityId: current.id,
          metadata: {
            stripeSubscriptionId: stripeSubscription.id,
            stripeStatus: stripeSubscription.status,
            cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
          },
        },
      });
    });
    await this.dashboardCache.invalidate();
  }

  private async processStripePaymentMethodEvent(event: Stripe.Event): Promise<void> {
    const paymentMethod = event.data.object as Stripe.PaymentMethod;
    const previous = event.data.previous_attributes as Partial<Stripe.PaymentMethod> | undefined;
    const stripeCustomerId =
      this.stripeId(paymentMethod.customer) ?? this.stripeId(previous?.customer ?? null);
    await this.prisma.$transaction(async (transaction) => {
      if (
        await transaction.paymentWebhookEvent.findUnique({ where: { providerEventId: event.id } })
      ) {
        return;
      }
      const customer = stripeCustomerId
        ? await transaction.customer.findUnique({ where: { stripeCustomerId } })
        : await transaction.customer.findFirst({
            where: { subscriptions: { some: { stripePaymentMethodId: paymentMethod.id } } },
          });
      if (!customer) return;
      if (event.type === 'payment_method.detached') {
        await transaction.subscription.updateMany({
          where: {
            customerId: customer.id,
            stripePaymentMethodId: paymentMethod.id,
          },
          data: {
            stripePaymentMethodId: null,
            paymentMethodType: null,
            paymentMethodBrand: null,
            paymentMethodLast4: null,
            paymentMethodExpMonth: null,
            paymentMethodExpYear: null,
          },
        });
      } else if (event.type === 'payment_method.updated') {
        await transaction.subscription.updateMany({
          where: { customerId: customer.id, stripePaymentMethodId: paymentMethod.id },
          data: {
            paymentMethodType: this.localPaymentMethodType(paymentMethod),
            paymentMethodBrand: paymentMethod.card?.brand,
            paymentMethodLast4: this.paymentMethodLast4(paymentMethod),
            paymentMethodExpMonth: paymentMethod.card?.exp_month,
            paymentMethodExpYear: paymentMethod.card?.exp_year,
          },
        });
      }
      await transaction.paymentWebhookEvent.create({
        data: {
          provider: PaymentProvider.STRIPE,
          providerEventId: event.id,
          eventType: event.type,
        },
      });
      await transaction.auditLog.create({
        data: {
          action:
            event.type === 'payment_method.attached'
              ? 'PAYMENT_METHOD_ADDED'
              : event.type === 'payment_method.detached'
                ? 'PAYMENT_METHOD_REMOVED'
                : 'PAYMENT_METHOD_UPDATED',
          entityType: 'Customer',
          entityId: customer.id,
          metadata: {
            eventType: event.type,
            type: this.localPaymentMethodType(paymentMethod),
            brand: paymentMethod.card?.brand ?? null,
            last4: this.paymentMethodLast4(paymentMethod),
          },
        },
      });
    });
    await this.dashboardCache.invalidate();
  }

  private async processStripeCustomerUpdated(event: Stripe.Event): Promise<void> {
    const stripeCustomer = event.data.object as Stripe.Customer;
    if ('deleted' in stripeCustomer && stripeCustomer.deleted) return;
    if (
      await this.prisma.paymentWebhookEvent.findUnique({ where: { providerEventId: event.id } })
    ) {
      return;
    }
    const customer = await this.prisma.customer.findUnique({
      where: { stripeCustomerId: stripeCustomer.id },
    });
    if (!customer) return;
    const paymentMethodId = this.stripeId(stripeCustomer.invoice_settings.default_payment_method);
    const paymentMethod = paymentMethodId
      ? await this.ownedPaymentMethod(paymentMethodId, stripeCustomer.id)
      : null;
    const subscriptions = await this.protectedRecurringSubscriptions(customer.id);
    if (paymentMethod) {
      await Promise.all(
        subscriptions
          .filter((subscription) => subscription.stripeSubscriptionId)
          .map((subscription) =>
            this.stripe.subscriptions.update(
              subscription.stripeSubscriptionId!,
              { default_payment_method: paymentMethod.id },
              {
                idempotencyKey: `customer-updated-subscription-${subscription.id}-${event.id}`,
              },
            ),
          ),
      );
      await this.retryOutstandingStripeInvoices(customer.id, paymentMethod.id, event.id);
    }
    await this.prisma.$transaction(async (transaction) => {
      if (
        await transaction.paymentWebhookEvent.findUnique({ where: { providerEventId: event.id } })
      ) {
        return;
      }
      await transaction.subscription.updateMany({
        where: {
          customerId: customer.id,
          billingMode: BillingMode.STRIPE_RECURRING,
          status: { in: protectedRecurringStatuses },
        },
        data: paymentMethod
          ? {
              stripePaymentMethodId: paymentMethod.id,
              paymentMethodType: this.localPaymentMethodType(paymentMethod),
              paymentMethodBrand: paymentMethod.card?.brand,
              paymentMethodLast4: this.paymentMethodLast4(paymentMethod),
              paymentMethodExpMonth: paymentMethod.card?.exp_month,
              paymentMethodExpYear: paymentMethod.card?.exp_year,
            }
          : {
              stripePaymentMethodId: null,
              paymentMethodType: null,
              paymentMethodBrand: null,
              paymentMethodLast4: null,
              paymentMethodExpMonth: null,
              paymentMethodExpYear: null,
            },
      });
      await transaction.paymentWebhookEvent.create({
        data: {
          provider: PaymentProvider.STRIPE,
          providerEventId: event.id,
          eventType: event.type,
        },
      });
      await transaction.auditLog.create({
        data: {
          action: paymentMethod
            ? 'DEFAULT_PAYMENT_METHOD_SYNCHRONIZED'
            : 'DEFAULT_PAYMENT_METHOD_CLEARED',
          entityType: 'Customer',
          entityId: customer.id,
          metadata: paymentMethod
            ? {
                type: this.localPaymentMethodType(paymentMethod),
                brand: paymentMethod.card?.brand ?? null,
                last4: this.paymentMethodLast4(paymentMethod),
              }
            : undefined,
        },
      });
    });
    await this.dashboardCache.invalidate();
  }

  private stripeSubscriptionIdFromInvoice(invoice: Stripe.Invoice): string | undefined {
    return this.stripeId(invoice.parent?.subscription_details?.subscription ?? null);
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

    const recurring = await this.loadRecurringCheckoutDetails(session);
    this.assertSelectedPaymentMethod(session, recurring.paymentMethodType);
    await this.synchronizeInitialRecurringPaymentMethod(session, recurring, providerEventId);
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
              roles: { create: { role: Role.CUSTOMER } },
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
          const serviceAddress = await transaction.serviceAddress.create({
            data: {
              customerId: customer.id,
              addressLine1: service.addressLine1,
              addressLine2: service.addressLine2,
              suburb: service.suburb,
              state: service.state.toUpperCase(),
              postcode: service.postcode,
            },
          });
          const subscription = await transaction.subscription.create({
            data: {
              customerId: customer.id,
              planId: application.planId,
              currentServiceAddressId: serviceAddress.id,
              monthlyCents: application.amountCents,
              status: SubscriptionStatus.ACTIVE,
              startDate: this.utcDate(paidAt),
              billingAnchorDay,
              billingMode: BillingMode.STRIPE_RECURRING,
              stripeSubscriptionId: recurring.stripeSubscriptionId,
              stripePriceId: recurring.stripePriceId,
              stripeStatus: recurring.stripeStatus,
              stripePaymentMethodId: recurring.paymentMethodId,
              paymentMethodType: recurring.paymentMethodType,
              paymentMethodBrand: recurring.paymentMethodBrand,
              paymentMethodLast4: recurring.paymentMethodLast4,
              paymentMethodExpMonth: recurring.paymentMethodExpMonth,
              paymentMethodExpYear: recurring.paymentMethodExpYear,
              cancelAtPeriodEnd: recurring.cancelAtPeriodEnd,
              currentPeriodStart: recurring.currentPeriodStart,
              currentPeriodEnd: recurring.currentPeriodEnd,
              nextBillingAt: recurring.currentPeriodEnd,
            },
          });
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(${PaymentsService.invoiceSequenceLock})`;
          const issueDate = this.utcDate(paidAt);
          const billingPeriod = {
            start: this.utcDate(recurring.currentPeriodStart),
            end: this.utcDate(new Date(recurring.currentPeriodEnd.getTime() - 1)),
          };
          const amounts = this.billing.calculateGstInclusiveAmounts(application.amountCents);
          const invoiceNumber = await this.nextInvoiceNumber(transaction, issueDate);
          const invoice = await transaction.invoice.create({
            data: {
              invoiceNumber,
              customerId: customer.id,
              subscriptionId: subscription.id,
              purchasePlanId: application.planId,
              type: InvoiceType.STRIPE_RECURRING,
              stripeInvoiceId: recurring.stripeInvoiceId,
              stripeHostedUrl: recurring.hostedInvoiceUrl,
              stripePdfUrl: recurring.invoicePdfUrl,
              issueDate,
              dueDate: this.billing.dueDateFor(issueDate),
              billingPeriodStart: billingPeriod.start,
              billingPeriodEnd: billingPeriod.end,
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
              providerPaymentId: recurring.paymentIntentId ?? paymentIntentId,
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
              stripePaymentIntentId: recurring.paymentIntentId ?? paymentIntentId,
              stripeSubscriptionId: recurring.stripeSubscriptionId,
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

  private async processPaymentMethodSetupEvent(
    event: Stripe.Event,
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    if (event.type !== 'checkout.session.completed') return;
    if (
      await this.prisma.paymentWebhookEvent.findUnique({ where: { providerEventId: event.id } })
    ) {
      return;
    }
    const customerId = session.metadata?.customerId ?? session.client_reference_id;
    const setupIntentId = this.stripeId(session.setup_intent);
    if (!customerId || !setupIntentId) {
      throw new BadRequestException('Stripe setup session is missing payment method references.');
    }
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (
      !customer?.stripeCustomerId ||
      this.stripeId(session.customer) !== customer.stripeCustomerId
    ) {
      throw new BadRequestException('Stripe setup session does not belong to this customer.');
    }
    const setupIntent = await this.stripe.setupIntents.retrieve(setupIntentId);
    const paymentMethodId = this.stripeId(setupIntent.payment_method);
    if (
      setupIntent.status !== 'succeeded' ||
      !paymentMethodId ||
      this.stripeId(setupIntent.customer) !== customer.stripeCustomerId
    ) {
      throw new BadRequestException('Stripe did not confirm a reusable payment method.');
    }
    const paymentMethod = await this.ownedPaymentMethod(paymentMethodId, customer.stripeCustomerId);
    this.assertUsablePaymentMethod(paymentMethod);
    this.assertSelectedPaymentMethod(session, this.localPaymentMethodType(paymentMethod));
    const subscriptions = await this.protectedRecurringSubscriptions(customer.id);
    await this.stripe.customers.update(
      customer.stripeCustomerId,
      { invoice_settings: { default_payment_method: paymentMethod.id } },
      { idempotencyKey: `payment-method-setup-customer-${customer.id}-${event.id}` },
    );
    await Promise.all(
      subscriptions
        .filter((subscription) => subscription.stripeSubscriptionId)
        .map((subscription) =>
          this.stripe.subscriptions.update(
            subscription.stripeSubscriptionId!,
            { default_payment_method: paymentMethod.id },
            { idempotencyKey: `payment-method-setup-subscription-${subscription.id}-${event.id}` },
          ),
        ),
    );
    await this.retryOutstandingStripeInvoices(customer.id, paymentMethod.id, event.id);
    await this.prisma.$transaction(async (transaction) => {
      if (
        await transaction.paymentWebhookEvent.findUnique({ where: { providerEventId: event.id } })
      ) {
        return;
      }
      await transaction.subscription.updateMany({
        where: {
          customerId: customer.id,
          billingMode: BillingMode.STRIPE_RECURRING,
          status: { in: protectedRecurringStatuses },
        },
        data: {
          stripePaymentMethodId: paymentMethod.id,
          paymentMethodType: this.localPaymentMethodType(paymentMethod),
          paymentMethodBrand: paymentMethod.card?.brand,
          paymentMethodLast4: this.paymentMethodLast4(paymentMethod),
          paymentMethodExpMonth: paymentMethod.card?.exp_month,
          paymentMethodExpYear: paymentMethod.card?.exp_year,
        },
      });
      await transaction.paymentWebhookEvent.create({
        data: {
          provider: PaymentProvider.STRIPE,
          providerEventId: event.id,
          eventType: event.type,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: customer.userId,
          action: 'DEFAULT_PAYMENT_METHOD_CHANGED',
          entityType: 'Customer',
          entityId: customer.id,
          metadata: {
            type: this.localPaymentMethodType(paymentMethod),
            brand: paymentMethod.card?.brand ?? null,
            last4: this.paymentMethodLast4(paymentMethod),
            operationId: session.metadata?.operationId ?? null,
          },
        },
      });
    });
    await this.dashboardCache.invalidate();
  }

  private async processRecurringSetupEvent(
    event: Stripe.Event,
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    const attemptId = session.metadata?.recurringSetupAttemptId;
    if (!attemptId) {
      throw new BadRequestException('Stripe setup session is missing its setup attempt reference.');
    }
    if (event.type === 'checkout.session.expired') {
      await this.prisma.recurringSetupAttempt.updateMany({
        where: {
          id: attemptId,
          stripeCheckoutSessionId: session.id,
          status: {
            in: [RecurringSetupAttemptStatus.PENDING, RecurringSetupAttemptStatus.CHECKOUT_CREATED],
          },
        },
        data: {
          status: RecurringSetupAttemptStatus.EXPIRED,
          failureReason: 'The automatic payment setup session expired.',
        },
      });
      return;
    }
    if (event.type !== 'checkout.session.completed') return;
    const localSubscriptionId =
      session.metadata?.existingSubscriptionId ?? session.client_reference_id;
    const setupIntentId = this.stripeId(session.setup_intent);
    if (!localSubscriptionId || !setupIntentId) {
      throw new BadRequestException(
        'Stripe setup session is missing recurring billing references.',
      );
    }
    if (
      await this.prisma.paymentWebhookEvent.findUnique({ where: { providerEventId: event.id } })
    ) {
      return;
    }
    const prepared = await this.prisma.$transaction(
      async (transaction) => {
        if (
          await transaction.paymentWebhookEvent.findUnique({
            where: { providerEventId: event.id },
          })
        ) {
          return null;
        }
        const attempt = await transaction.recurringSetupAttempt.findUnique({
          where: { id: attemptId },
        });
        if (
          !attempt ||
          attempt.subscriptionId !== localSubscriptionId ||
          attempt.stripeCheckoutSessionId !== session.id
        ) {
          throw new BadRequestException('Stripe setup session does not match its setup attempt.');
        }
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${attempt.subscriptionId}))`;
        const local = await transaction.subscription.findUnique({
          where: { id: attempt.subscriptionId },
          include: { customer: true, plan: true },
        });
        if (!local || !local.customer.stripeCustomerId || !local.plan.stripePriceId) {
          throw new BadRequestException('The subscription is not ready for automatic billing.');
        }
        if (
          attempt.status === RecurringSetupAttemptStatus.COMPLETED &&
          local.billingMode === BillingMode.STRIPE_RECURRING &&
          local.stripeSubscriptionId === attempt.stripeSubscriptionId
        ) {
          await transaction.paymentWebhookEvent.create({
            data: {
              provider: PaymentProvider.STRIPE,
              providerEventId: event.id,
              eventType: event.type,
            },
          });
          return null;
        }
        if (
          attempt.status !== RecurringSetupAttemptStatus.PENDING &&
          attempt.status !== RecurringSetupAttemptStatus.CHECKOUT_CREATED &&
          attempt.status !== RecurringSetupAttemptStatus.PROCESSING
        ) {
          await transaction.paymentWebhookEvent.create({
            data: {
              provider: PaymentProvider.STRIPE,
              providerEventId: event.id,
              eventType: event.type,
            },
          });
          return null;
        }
        const outstanding = await transaction.invoice.count({
          where: {
            subscriptionId: local.id,
            status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.OVERDUE] },
          },
        });
        try {
          this.assertRecurringSetupEligible(local, outstanding);
          this.assertRecurringSetupSnapshot(attempt, local, session);
        } catch (error: unknown) {
          if (!(error instanceof ConflictException || error instanceof BadRequestException)) {
            throw error;
          }
          await transaction.recurringSetupAttempt.update({
            where: { id: attempt.id },
            data: {
              status: RecurringSetupAttemptStatus.CANCELLED,
              failureReason: error.message.slice(0, 500),
            },
          });
          await transaction.paymentWebhookEvent.create({
            data: {
              provider: PaymentProvider.STRIPE,
              providerEventId: event.id,
              eventType: event.type,
            },
          });
          return null;
        }
        await transaction.recurringSetupAttempt.update({
          where: { id: attempt.id },
          data: {
            status: RecurringSetupAttemptStatus.PROCESSING,
            stripeSetupIntentId: setupIntentId,
            failureReason: null,
          },
        });
        return { attempt, local };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (!prepared) return;
    const { attempt, local } = prepared;
    const setupIntent = await this.stripe.setupIntents.retrieve(setupIntentId);
    const paymentMethodId = this.stripeId(setupIntent.payment_method);
    if (
      setupIntent.status !== 'succeeded' ||
      !paymentMethodId ||
      this.stripeId(setupIntent.customer) !== local.customer.stripeCustomerId
    ) {
      throw new BadRequestException('Stripe did not confirm a reusable payment method.');
    }
    const paymentMethod = await this.resolvePaymentMethod(paymentMethodId);
    if (!paymentMethod) {
      throw new BadRequestException('Stripe did not return the configured payment method.');
    }
    this.assertUsablePaymentMethod(paymentMethod);
    this.assertSelectedPaymentMethod(session, this.localPaymentMethodType(paymentMethod));
    const trialEnd = Math.floor(attempt.expectedCurrentPeriodEnd.getTime() / 1_000);
    if (trialEnd <= Math.floor(Date.now() / 1_000)) {
      throw new ConflictException('The current billing period ended before setup completed.');
    }
    const stripeSubscription = await this.stripe.subscriptions.create(
      {
        customer: local.customer.stripeCustomerId,
        items: [{ price: attempt.expectedStripePriceId }],
        default_payment_method: paymentMethodId,
        trial_end: trialEnd,
        payment_settings: { save_default_payment_method: 'on_subscription' },
        metadata: {
          checkoutKind: 'enable_recurring',
          recurringSetupAttemptId: attempt.id,
          meroSubscriptionId: local.id,
          customerId: local.customerId,
          planId: attempt.expectedPlanId,
        },
      },
      { idempotencyKey: `recurring-subscription-${attempt.id}` },
    );
    const item = stripeSubscription.items.data[0];
    if (!item) {
      await this.cancelOrphanedRecurringSubscription(stripeSubscription.id, attempt.id);
      throw new BadRequestException('Stripe subscription has no recurring price item.');
    }
    try {
      await this.stripe.customers.update(
        local.customer.stripeCustomerId,
        { invoice_settings: { default_payment_method: paymentMethod.id } },
        { idempotencyKey: `recurring-default-payment-method-${attempt.id}` },
      );
      await this.prisma.$transaction(
        async (transaction) => {
          if (
            await transaction.paymentWebhookEvent.findUnique({
              where: { providerEventId: event.id },
            })
          ) {
            return;
          }
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${local.id}))`;
          const current = await transaction.subscription.findUnique({
            where: { id: local.id },
            include: { customer: true, plan: true },
          });
          if (!current) throw new NotFoundException('Subscription not found.');
          const outstanding = await transaction.invoice.count({
            where: {
              subscriptionId: current.id,
              status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.OVERDUE] },
            },
          });
          this.assertRecurringSetupEligible(current, outstanding);
          this.assertRecurringSetupSnapshot(attempt, current, session);
          const updated = await transaction.subscription.updateMany({
            where: {
              id: current.id,
              status: SubscriptionStatus.ACTIVE,
              billingMode: BillingMode.MANUAL,
              stripeSubscriptionId: null,
              planId: attempt.expectedPlanId,
              currentPeriodStart: attempt.expectedCurrentPeriodStart,
              currentPeriodEnd: attempt.expectedCurrentPeriodEnd,
              updatedAt: attempt.expectedSubscriptionUpdatedAt,
            },
            data: {
              billingMode: BillingMode.STRIPE_RECURRING,
              stripeSubscriptionId: stripeSubscription.id,
              stripePriceId: item.price.id,
              stripeStatus: stripeSubscription.status,
              stripePaymentMethodId: paymentMethodId,
              paymentMethodType: this.localPaymentMethodType(paymentMethod),
              paymentMethodBrand: paymentMethod.card?.brand,
              paymentMethodLast4: this.paymentMethodLast4(paymentMethod),
              paymentMethodExpMonth: paymentMethod.card?.exp_month,
              paymentMethodExpYear: paymentMethod.card?.exp_year,
              cancelAtPeriodEnd: false,
              nextBillingAt: attempt.expectedCurrentPeriodEnd,
            },
          });
          if (updated.count !== 1) {
            throw new ConflictException(
              'The subscription changed while automatic payments were being enabled.',
            );
          }
          await transaction.recurringSetupAttempt.update({
            where: { id: attempt.id },
            data: {
              status: RecurringSetupAttemptStatus.COMPLETED,
              stripeSubscriptionId: stripeSubscription.id,
              completedAt: new Date(),
              failureReason: null,
            },
          });
          await transaction.paymentWebhookEvent.create({
            data: {
              provider: PaymentProvider.STRIPE,
              providerEventId: event.id,
              eventType: event.type,
            },
          });
          await transaction.auditLog.create({
            data: {
              actorUserId: local.customer.userId,
              action: 'AUTOMATIC_BILLING_ENABLED',
              entityType: 'Subscription',
              entityId: local.id,
              metadata: {
                recurringSetupAttemptId: attempt.id,
                stripeSubscriptionId: stripeSubscription.id,
                nextBillingAt: attempt.expectedCurrentPeriodEnd.toISOString(),
              },
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error: unknown) {
      const compensated = await this.cancelOrphanedRecurringSubscription(
        stripeSubscription.id,
        attempt.id,
      );
      if (!compensated) throw error;
      await this.prisma.recurringSetupAttempt.updateMany({
        where: { id: attempt.id, status: RecurringSetupAttemptStatus.PROCESSING },
        data: {
          status: RecurringSetupAttemptStatus.FAILED,
          stripeSubscriptionId: stripeSubscription.id,
          failureReason: 'The subscription changed before automatic billing could be activated.',
        },
      });
      try {
        await this.prisma.paymentWebhookEvent.create({
          data: {
            provider: PaymentProvider.STRIPE,
            providerEventId: event.id,
            eventType: event.type,
          },
        });
      } catch (eventError: unknown) {
        if (
          !(
            eventError instanceof Prisma.PrismaClientKnownRequestError &&
            eventError.code === 'P2002'
          )
        ) {
          throw eventError;
        }
      }
      this.logger.warn(
        JSON.stringify({
          event: 'recurring_setup_compensated',
          attemptId: attempt.id,
          stripeSubscriptionId: stripeSubscription.id,
          error: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
      return;
    }
    await this.dashboardCache.invalidate();
  }

  private async loadRecurringCheckoutDetails(
    session: Stripe.Checkout.Session,
  ): Promise<RecurringCheckoutDetails> {
    const subscriptionId = this.stripeId(session.subscription);
    const invoiceId = this.stripeId(session.invoice);
    if (!subscriptionId || !invoiceId) {
      throw new BadRequestException(
        'Stripe Checkout did not return the recurring subscription billing references.',
      );
    }
    const [subscription, invoice] = await Promise.all([
      this.stripe.subscriptions.retrieve(subscriptionId, {
        expand: ['default_payment_method'],
      }),
      this.stripe.invoices.retrieve(invoiceId, {
        expand: ['payments.data.payment.payment_intent'],
      }),
    ]);
    const item = subscription.items.data[0];
    if (!item) throw new BadRequestException('Stripe subscription has no recurring price item.');
    const paymentMethod =
      (await this.resolvePaymentMethod(subscription.default_payment_method)) ??
      (await this.resolveInvoicePaymentMethod(invoice));
    if (!paymentMethod) {
      throw new BadRequestException(
        'Stripe did not retain a reusable payment method for this subscription.',
      );
    }
    return {
      stripeSubscriptionId: subscription.id,
      stripeInvoiceId: invoice.id,
      stripePriceId: item.price.id,
      stripeStatus: subscription.status,
      currentPeriodStart: new Date(item.current_period_start * 1_000),
      currentPeriodEnd: new Date(item.current_period_end * 1_000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      paymentIntentId: this.invoicePaymentIntentId(invoice),
      paymentMethodId: paymentMethod.id,
      paymentMethodType: this.localPaymentMethodType(paymentMethod) ?? undefined,
      paymentMethodBrand: paymentMethod?.card?.brand,
      paymentMethodLast4: this.paymentMethodLast4(paymentMethod) ?? undefined,
      paymentMethodExpMonth: paymentMethod?.card?.exp_month,
      paymentMethodExpYear: paymentMethod?.card?.exp_year,
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? undefined,
      invoicePdfUrl: invoice.invoice_pdf ?? undefined,
    };
  }

  private async synchronizeInitialRecurringPaymentMethod(
    session: Stripe.Checkout.Session,
    recurring: RecurringCheckoutDetails,
    operationId: string,
  ): Promise<void> {
    const stripeCustomerId = this.stripeId(session.customer);
    if (!stripeCustomerId) {
      throw new BadRequestException('Stripe Checkout did not return a customer reference.');
    }
    const idempotencySuffix = this.stableLetters(operationId);
    await Promise.all([
      this.stripe.customers.update(
        stripeCustomerId,
        { invoice_settings: { default_payment_method: recurring.paymentMethodId } },
        {
          idempotencyKey: `initial-payment-method-customer-${stripeCustomerId}-${idempotencySuffix}`,
        },
      ),
      this.stripe.subscriptions.update(
        recurring.stripeSubscriptionId,
        {
          default_payment_method: recurring.paymentMethodId,
          payment_settings: { save_default_payment_method: 'on_subscription' },
        },
        {
          idempotencyKey: `initial-payment-method-subscription-${recurring.stripeSubscriptionId}-${idempotencySuffix}`,
        },
      ),
      this.prisma.subscription.updateMany({
        where: { stripeSubscriptionId: recurring.stripeSubscriptionId },
        data: {
          stripePaymentMethodId: recurring.paymentMethodId,
          paymentMethodType: recurring.paymentMethodType,
          paymentMethodBrand: recurring.paymentMethodBrand,
          paymentMethodLast4: recurring.paymentMethodLast4,
          paymentMethodExpMonth: recurring.paymentMethodExpMonth,
          paymentMethodExpYear: recurring.paymentMethodExpYear,
        },
      }),
    ]);
  }

  private async resolveInvoicePaymentMethod(
    invoice: Stripe.Invoice,
  ): Promise<Stripe.PaymentMethod | null> {
    const reference = invoice.payments?.data.find(
      (payment) => payment.status === 'paid' || payment.is_default,
    )?.payment.payment_intent;
    if (!reference) return null;
    const paymentIntent =
      typeof reference === 'string'
        ? await this.stripe.paymentIntents.retrieve(reference)
        : reference;
    return this.resolvePaymentMethod(paymentIntent.payment_method);
  }

  private async resolvePaymentMethod(
    value: string | Stripe.PaymentMethod | null,
  ): Promise<Stripe.PaymentMethod | null> {
    if (!value) return null;
    return typeof value === 'string' ? this.stripe.paymentMethods.retrieve(value) : value;
  }

  private async customerForActor(actor: AuthenticatedUser) {
    const customer = await this.prisma.customer.findUnique({ where: { userId: actor.id } });
    if (!customer) throw new NotFoundException('Customer account not found.');
    return customer;
  }

  private async ensureStripeCustomerForActor(actor: AuthenticatedUser) {
    const customer = await this.customerForActor(actor);
    if (customer.stripeCustomerId) return customer;
    const stripeCustomer = await this.stripe.customers.create(
      {
        email: customer.email,
        name: `${customer.firstName} ${customer.lastName}`,
        metadata: { meroCustomerId: customer.id },
      },
      { idempotencyKey: `payment-method-customer-${customer.id}` },
    );
    return this.prisma.customer.update({
      where: { id: customer.id },
      data: { stripeCustomerId: stripeCustomer.id },
    });
  }

  private async ownedPaymentMethod(
    paymentMethodId: string,
    stripeCustomerId: string,
  ): Promise<Stripe.PaymentMethod> {
    let paymentMethod: Stripe.PaymentMethod;
    try {
      paymentMethod = await this.stripe.paymentMethods.retrieve(paymentMethodId);
    } catch {
      throw new NotFoundException('Payment method not found for this account.');
    }
    if (this.stripeId(paymentMethod.customer) !== stripeCustomerId) {
      throw new NotFoundException('Payment method not found for this account.');
    }
    return paymentMethod;
  }

  private assertUsablePaymentMethod(paymentMethod: Stripe.PaymentMethod): void {
    this.localPaymentMethodType(paymentMethod);
    if (!paymentMethod.card) return;
    const now = new Date();
    if (
      paymentMethod.card.exp_year < now.getUTCFullYear() ||
      (paymentMethod.card.exp_year === now.getUTCFullYear() &&
        paymentMethod.card.exp_month < now.getUTCMonth() + 1)
    ) {
      throw new BadRequestException('This card has expired. Add a valid card before using it.');
    }
  }

  private async processStripePaymentIntentState(
    event: Stripe.PaymentIntentProcessingEvent | Stripe.PaymentIntentPaymentFailedEvent,
  ): Promise<void> {
    const paymentIntent = event.data.object;
    const payment = await this.prisma.payment.findUnique({
      where: {
        provider_providerPaymentId: {
          provider: PaymentProvider.STRIPE,
          providerPaymentId: paymentIntent.id,
        },
      },
    });
    if (!payment) return;
    await this.prisma.$transaction(async (transaction) => {
      if (
        await transaction.paymentWebhookEvent.findUnique({
          where: { providerEventId: event.id },
        })
      ) {
        return;
      }
      const status =
        event.type === 'payment_intent.processing'
          ? PaymentStatus.PROCESSING
          : PaymentStatus.FAILED;
      await transaction.payment.updateMany({
        where: {
          id: payment.id,
          status: { in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING, PaymentStatus.FAILED] },
        },
        data: { status },
      });
      await transaction.paymentWebhookEvent.create({
        data: {
          provider: PaymentProvider.STRIPE,
          providerEventId: event.id,
          eventType: event.type,
          paymentId: payment.id,
        },
      });
      await transaction.auditLog.create({
        data: {
          action:
            status === PaymentStatus.PROCESSING
              ? 'AUTOMATIC_PAYMENT_PROCESSING'
              : 'AUTOMATIC_PAYMENT_FAILED',
          entityType: 'Payment',
          entityId: payment.id,
          metadata: {
            paymentMethodType: payment.paymentMethodType,
            providerPaymentId: paymentIntent.id,
          },
        },
      });
    });
    await this.dashboardCache.invalidate();
  }

  private localPaymentMethodType(paymentMethod: Stripe.PaymentMethod): PaymentMethodType | null {
    if (paymentMethod.type === 'card' || paymentMethod.card) return PaymentMethodType.CARD;
    if (paymentMethod.type === 'au_becs_debit' || paymentMethod.au_becs_debit) {
      return PaymentMethodType.AU_BECS_DEBIT;
    }
    return null;
  }

  private paymentMethodLast4(paymentMethod: Stripe.PaymentMethod): string | null {
    return paymentMethod.card?.last4 ?? paymentMethod.au_becs_debit?.last4 ?? null;
  }

  private paymentMethodConfiguration(paymentMethodType: PaymentMethodType): {
    payment_method_configuration?: string;
  } {
    const stripeConfig = this.configService.getOrThrow('stripe');
    const configurationId =
      paymentMethodType === PaymentMethodType.AU_BECS_DEBIT
        ? stripeConfig.becsPaymentMethodConfigurationId
        : stripeConfig.cardPaymentMethodConfigurationId;
    if (!configurationId && paymentMethodType === PaymentMethodType.AU_BECS_DEBIT) {
      throw new BadRequestException(
        'Direct Debit is not configured yet. Choose card or contact support.',
      );
    }
    return configurationId ? { payment_method_configuration: configurationId } : {};
  }

  private assertSelectedPaymentMethod(
    session: Stripe.Checkout.Session,
    actual: PaymentMethodType | null | undefined,
  ): void {
    const selected = session.metadata?.paymentMethodType;
    if (selected && selected !== actual) {
      throw new BadRequestException('Stripe returned a different payment method than selected.');
    }
  }

  private protectedRecurringSubscriptions(customerId: string) {
    return this.prisma.subscription.findMany({
      where: {
        customerId,
        billingMode: BillingMode.STRIPE_RECURRING,
        status: { in: protectedRecurringStatuses },
      },
      select: { id: true, stripeSubscriptionId: true },
    });
  }

  private async persistDefaultPaymentMethod(input: {
    customerId: string;
    actorUserId?: string | null;
    paymentMethod: Stripe.PaymentMethod;
    action: string;
    entityId: string;
    operationId: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.subscription.updateMany({
        where: {
          customerId: input.customerId,
          billingMode: BillingMode.STRIPE_RECURRING,
          status: { in: protectedRecurringStatuses },
        },
        data: {
          stripePaymentMethodId: input.paymentMethod.id,
          paymentMethodType: this.localPaymentMethodType(input.paymentMethod),
          paymentMethodBrand: input.paymentMethod.card?.brand,
          paymentMethodLast4: this.paymentMethodLast4(input.paymentMethod),
          paymentMethodExpMonth: input.paymentMethod.card?.exp_month,
          paymentMethodExpYear: input.paymentMethod.card?.exp_year,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: input.action,
          entityType: 'Customer',
          entityId: input.entityId,
          metadata: {
            brand: input.paymentMethod.card?.brand ?? null,
            last4: input.paymentMethod.card?.last4 ?? null,
            operationId: input.operationId,
          },
        },
      });
    });
  }

  private async retryOutstandingStripeInvoices(
    customerId: string,
    paymentMethodId: string,
    operationId: string,
  ): Promise<void> {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        customerId,
        type: InvoiceType.STRIPE_RECURRING,
        stripeInvoiceId: { not: null },
        status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.OVERDUE] },
      },
      select: { id: true, stripeInvoiceId: true },
    });
    await Promise.all(
      invoices.map(async (invoice) => {
        try {
          await this.stripe.invoices.pay(
            invoice.stripeInvoiceId!,
            { payment_method: paymentMethodId },
            {
              idempotencyKey: `retry-invoice-${invoice.id}-${this.stableLetters(operationId)}`,
            },
          );
        } catch (error: unknown) {
          this.logger.warn(
            JSON.stringify({
              event: 'stripe.invoice.retry_failed',
              invoiceId: invoice.id,
              reason: error instanceof Error ? error.message : 'unknown_error',
            }),
          );
        }
      }),
    );
  }

  private invoicePaymentIntentId(invoice: Stripe.Invoice): string | undefined {
    const intent = invoice.payments?.data.find(
      (payment) => payment.status === 'paid' || payment.is_default,
    )?.payment.payment_intent;
    return this.stripeId(intent ?? null);
  }

  private async stripeInvoicePaymentFailure(invoice: Stripe.Invoice): Promise<{ code?: string }> {
    const paymentIntentId = this.invoicePaymentIntentId(invoice);
    if (!paymentIntentId) return {};
    try {
      const paymentIntent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
      const code =
        paymentIntent.last_payment_error?.decline_code ?? paymentIntent.last_payment_error?.code;
      return { code: code ? String(code).slice(0, 100) : undefined };
    } catch (error: unknown) {
      this.logger.warn(
        JSON.stringify({
          event: 'stripe.payment_failure_details_unavailable',
          stripeInvoiceId: invoice.id,
          paymentIntentId,
          error: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
      return {};
    }
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

  private normalizedAddress(address: NormalizedAddressSuggestion): StoredAddress {
    const streetAddress = [address.houseNumber, address.street].filter(Boolean).join(' ').trim();
    const addressLine1 = streetAddress || address.formattedAddress.split(',')[0]?.trim();
    const suburb = address.suburb ?? address.city;
    const state = normalizeAustralianStateCode(address.stateCode, address.state);
    if (
      !addressLine1 ||
      addressLine1.length > 255 ||
      !suburb ||
      suburb.length > 100 ||
      !state ||
      !address.postcode ||
      !/^\d{4}$/.test(address.postcode)
    ) {
      throw new BadRequestException(
        'The selected address is incomplete. Please choose a more specific address.',
      );
    }
    return {
      addressLine1,
      addressLine2: address.unit || null,
      suburb,
      state,
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

  private stableLetters(value: string): string {
    return Array.from(createHash('sha256').update(value).digest().subarray(0, 8), (byte) =>
      String.fromCharCode(97 + (byte % 26)),
    ).join('');
  }

  private assertRecurringSetupEligible(
    subscription: RecurringSetupSubscription,
    outstandingInvoiceCount: number,
    now = new Date(),
  ): void {
    if (subscription.status !== SubscriptionStatus.ACTIVE) {
      throw new ConflictException(
        'The subscription is no longer active, so automatic payments were not enabled.',
      );
    }
    if (subscription.billingMode !== BillingMode.MANUAL || subscription.stripeSubscriptionId) {
      throw new ConflictException('Automatic recurring payments are already enabled.');
    }
    if (!subscription.plan.stripePriceId) {
      throw new BadRequestException('Automatic billing is not configured for this plan yet.');
    }
    if (subscription.currentPeriodEnd <= now) {
      throw new ConflictException('The current billing period has ended. Refresh and try again.');
    }
    if (outstandingInvoiceCount > 0) {
      throw new ConflictException('Pay outstanding invoices before enabling automatic payments.');
    }
  }

  private assertRecurringSetupSnapshot(
    attempt: RecurringSetupAttemptRecord,
    subscription: RecurringSetupSubscription,
    session: Stripe.Checkout.Session,
  ): void {
    const unchanged =
      attempt.customerId === subscription.customerId &&
      attempt.expectedPlanId === subscription.planId &&
      attempt.expectedStripePriceId === subscription.plan.stripePriceId &&
      attempt.expectedCurrentPeriodStart.getTime() === subscription.currentPeriodStart.getTime() &&
      attempt.expectedCurrentPeriodEnd.getTime() === subscription.currentPeriodEnd.getTime() &&
      attempt.expectedSubscriptionUpdatedAt.getTime() === subscription.updatedAt.getTime() &&
      attempt.paymentMethodType === session.metadata?.paymentMethodType &&
      this.stripeId(session.customer) === subscription.customer.stripeCustomerId;
    if (!unchanged) {
      throw new ConflictException(
        'The subscription changed after automatic payment setup started. Start a new setup attempt.',
      );
    }
  }

  private async cancelOrphanedRecurringSubscription(
    stripeSubscriptionId: string,
    attemptId: string,
  ): Promise<boolean> {
    try {
      await this.stripe.subscriptions.cancel(
        stripeSubscriptionId,
        { invoice_now: false, prorate: false },
        { idempotencyKey: `recurring-setup-compensation-${attemptId}` },
      );
      return true;
    } catch (error: unknown) {
      this.logger.error(
        JSON.stringify({
          event: 'recurring_setup_compensation_failed',
          attemptId,
          stripeSubscriptionId,
          error: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
      return false;
    }
  }

  private reconciliationEventId(sessionId: string): string {
    return `reconcile:${sessionId}`;
  }

  private async assertCanPurchasePlan(customerId: string): Promise<void> {
    const current = await this.prisma.subscription.count({
      where: {
        customerId,
        status: {
          in: [
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.PAST_DUE,
            SubscriptionStatus.SUSPENDED,
            SubscriptionStatus.CANCELLATION_PENDING,
            SubscriptionStatus.DISCONNECTION_PENDING,
          ],
        },
      },
    });
    if (current) {
      throw new ConflictException(
        'You already have a current subscription. Use My subscription to upgrade or downgrade your plan.',
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
              status: {
                in: [
                  SubscriptionStatus.ACTIVE,
                  SubscriptionStatus.PAST_DUE,
                  SubscriptionStatus.SUSPENDED,
                  SubscriptionStatus.CANCELLATION_PENDING,
                  SubscriptionStatus.DISCONNECTION_PENDING,
                ],
              },
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
              type: InvoiceType.PLAN_PURCHASE,
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
    if (!invoice.purchasePlan.stripePriceId) {
      throw new BadRequestException('Automatic billing is not configured for this plan yet.');
    }

    const metadata = {
      checkoutKind: 'plan_purchase',
      invoiceId: invoice.id,
      customerId: invoice.customerId,
      planId: invoice.purchasePlan.id,
    };
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        integration_identifier: `mero_telecom_plan_${this.randomLetters(8)}`,
        ...(invoice.customer.stripeCustomerId
          ? { customer: invoice.customer.stripeCustomerId }
          : { customer_email: invoice.customer.email }),
        client_reference_id: invoice.id,
        metadata,
        subscription_data: {
          metadata,
        },
        line_items: [
          {
            quantity: 1,
            price: invoice.purchasePlan.stripePriceId,
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
