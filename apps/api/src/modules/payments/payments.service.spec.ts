import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  CheckoutApplicationStatus,
  CustomerStatus,
  InvoiceStatus,
  PaymentStatus,
  Role,
  SubscriptionStatus,
  UserStatus,
} from '@prisma/client';
import type Stripe from 'stripe';

import type { AppConfig } from '../../config/configuration';
import type { PrismaService } from '../../database/prisma.service';
import { BillingService } from '../billing/billing.service';
import { PaymentsService } from './payments.service';
import { StripeClientService } from './stripe-client.service';

const stripeSecret = 'whsec_phase13_test_secret';
const invoiceId = '6b34d995-21a6-4d36-8e28-1f465f93cc66';
const customerId = '46ed2dc1-1ff8-4649-8440-1aa4355b97ad';
const trustedAddress = {
  provider: 'geoapify' as const,
  providerAddressId: 'trusted-test-address',
  formattedAddress: '9 Test Street, Adelaide SA 5000, Australia',
  unit: null,
  houseNumber: '9',
  street: 'Test Street',
  suburb: 'Adelaide',
  city: 'Adelaide',
  state: 'South Australia',
  stateCode: 'SA',
  postcode: '5000',
  countryCode: 'au',
  latitude: -34.92,
  longitude: 138.6,
};

function checkoutContextMock() {
  return {
    consume: jest.fn().mockResolvedValue({
      version: 1,
      planId: '4ccdfc07-0bac-40e6-93fe-728d00740379',
      trustedServiceAddress: trustedAddress,
      technology: 'FTTP',
      maximumSpeedMbps: 100,
      checkedAt: '2026-08-25T00:00:00.000Z',
      expiresAt: '2026-08-25T00:30:00.000Z',
    }),
  };
}

function makeService(prisma: Partial<PrismaService>) {
  const configService = {
    getOrThrow: jest.fn((key: keyof AppConfig) => {
      if (key === 'stripe')
        return { secretKey: 'sk_test_phase13_unit_test', webhookSecret: stripeSecret };
      return { frontendUrl: 'http://localhost:3000' };
    }),
  };
  return new PaymentsService(
    prisma as PrismaService,
    configService as never,
    new StripeClientService(configService as never),
    {
      invalidate: jest.fn().mockResolvedValue(true),
    } as never,
    new BillingService(),
    { assertTrustedAddressCanOrderPlan: jest.fn().mockResolvedValue(undefined) } as never,
    { consume: jest.fn().mockResolvedValue(trustedAddress) } as never,
    checkoutContextMock() as never,
    {
      issueWithinTransaction: jest.fn(),
      queueDelivery: jest.fn().mockResolvedValue(true),
    } as never,
    { sendSubscriptionConfirmation: jest.fn().mockResolvedValue({}) } as never,
    { processStripeEvent: jest.fn().mockResolvedValue(undefined) } as never,
    { processStripeEvent: jest.fn().mockResolvedValue(undefined) } as never,
    {
      handleConfirmedPayment: jest.fn().mockResolvedValue(undefined),
      handlePaymentFailure: jest.fn().mockResolvedValue(undefined),
    } as never,
  );
}

function makePublicService(prisma: Partial<PrismaService>) {
  const configService = {
    getOrThrow: jest.fn((key: keyof AppConfig) => {
      if (key === 'stripe')
        return { secretKey: 'sk_test_public_checkout', webhookSecret: stripeSecret };
      if (key === 'app') return { frontendUrl: 'http://localhost:3000' };
      return { accountInvitationTtlHours: 24 };
    }),
  };
  const invitations = {
    issueWithinTransaction: jest.fn().mockResolvedValue({
      invitationId: 'invitation-id',
      userId: 'new-user-id',
      token: 'single-use-token',
      expiresAt: new Date('2026-08-22T00:00:00.000Z'),
      reason: 'ONLINE_PURCHASE',
    }),
    queueDelivery: jest.fn().mockResolvedValue(true),
  };
  const notifications = {
    sendSubscriptionConfirmation: jest.fn().mockResolvedValue({ messageId: 'message-id' }),
  };
  const publicCheckoutContext = checkoutContextMock();
  const addressSelections = {
    consume: jest.fn().mockResolvedValue(trustedAddress),
  };
  const service = new PaymentsService(
    prisma as PrismaService,
    configService as never,
    new StripeClientService(configService as never),
    { invalidate: jest.fn().mockResolvedValue(true) } as never,
    new BillingService(),
    { assertTrustedAddressCanOrderPlan: jest.fn().mockResolvedValue(undefined) } as never,
    addressSelections as never,
    publicCheckoutContext as never,
    invitations as never,
    notifications as never,
    { processStripeEvent: jest.fn().mockResolvedValue(undefined) } as never,
    { processStripeEvent: jest.fn().mockResolvedValue(undefined) } as never,
    {
      handleConfirmedPayment: jest.fn().mockResolvedValue(undefined),
      handlePaymentFailure: jest.fn().mockResolvedValue(undefined),
    } as never,
  );
  return { addressSelections, invitations, notifications, publicCheckoutContext, service };
}

function mockRecurringResources(service: PaymentsService, paymentIntentId: string) {
  const stripe = (service as unknown as { stripe: Stripe }).stripe as unknown as {
    customers: { update: jest.Mock };
    subscriptions: { retrieve: jest.Mock; update: jest.Mock };
    invoices: { retrieve: jest.Mock };
  };
  const customerUpdate = jest.fn().mockResolvedValue({ id: 'cus_test_public_123' });
  const subscriptionUpdate = jest.fn().mockResolvedValue({ id: 'sub_test_recurring' });
  stripe.customers = { update: customerUpdate };
  stripe.subscriptions = {
    retrieve: jest.fn().mockResolvedValue({
      id: 'sub_test_recurring',
      status: 'active',
      cancel_at_period_end: false,
      default_payment_method: {
        id: 'pm_test_card',
        card: { brand: 'visa', last4: '4242', exp_month: 8, exp_year: 2029 },
      },
      items: {
        data: [
          {
            price: { id: 'price_test_home_plus' },
            current_period_start: 1_785_542_400,
            current_period_end: 1_788_220_800,
          },
        ],
      },
    }),
    update: subscriptionUpdate,
  };
  stripe.invoices = {
    retrieve: jest.fn().mockResolvedValue({
      id: 'in_test_recurring',
      hosted_invoice_url: 'https://invoice.stripe.test/in_test_recurring',
      invoice_pdf: 'https://invoice.stripe.test/in_test_recurring.pdf',
      payments: {
        data: [
          {
            status: 'paid',
            is_default: true,
            payment: { payment_intent: paymentIntentId },
          },
        ],
      },
    }),
  };
  return { customerUpdate, subscriptionUpdate };
}

describe('PaymentsService', () => {
  it('recovers a new subscription card from the paid invoice when Stripe omits the subscription default', async () => {
    const service = makeService({});
    const stripe = (service as unknown as { stripe: Stripe }).stripe as unknown as {
      subscriptions: { retrieve: jest.Mock };
      invoices: { retrieve: jest.Mock };
    };
    stripe.subscriptions = {
      retrieve: jest.fn().mockResolvedValue({
        id: 'sub_new_customer',
        status: 'active',
        cancel_at_period_end: false,
        default_payment_method: null,
        items: {
          data: [
            {
              price: { id: 'price_test_home_plus' },
              current_period_start: 1_785_542_400,
              current_period_end: 1_788_220_800,
            },
          ],
        },
      }),
    };
    stripe.invoices = {
      retrieve: jest.fn().mockResolvedValue({
        id: 'in_new_customer',
        hosted_invoice_url: null,
        invoice_pdf: null,
        payments: {
          data: [
            {
              status: 'paid',
              is_default: true,
              payment: {
                payment_intent: {
                  id: 'pi_new_customer',
                  object: 'payment_intent',
                  payment_method: {
                    id: 'pm_new_customer',
                    object: 'payment_method',
                    type: 'card',
                    customer: 'cus_new_customer',
                    card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 },
                  },
                },
              },
            },
          ],
        },
      }),
    };

    const recurring = await (
      service as unknown as {
        loadRecurringCheckoutDetails(session: Stripe.Checkout.Session): Promise<{
          stripeSubscriptionId: string;
          paymentMethodId: string;
          paymentMethodBrand?: string;
          paymentMethodLast4?: string;
        }>;
      }
    ).loadRecurringCheckoutDetails({
      subscription: 'sub_new_customer',
      invoice: 'in_new_customer',
    } as Stripe.Checkout.Session);

    expect(recurring).toEqual(
      expect.objectContaining({
        stripeSubscriptionId: 'sub_new_customer',
        paymentMethodId: 'pm_new_customer',
        paymentMethodBrand: 'visa',
        paymentMethodLast4: '4242',
      }),
    );
  });

  it('reconciles an owned paid Checkout before returning authenticated status', async () => {
    const actor = {
      id: 'customer-user-id',
      email: 'customer@merotelecom.test',
      role: Role.CUSTOMER,
    };
    const session = {
      id: 'cs_test_paid_reconciliation',
      status: 'complete',
      payment_status: 'paid',
    } as Stripe.Checkout.Session;
    const prisma = {
      payment: {
        findFirst: jest.fn().mockResolvedValue({ id: 'payment-id' }),
        findUnique: jest.fn().mockResolvedValue({
          status: PaymentStatus.SUCCEEDED,
          invoice: {
            status: InvoiceStatus.PAID,
            subscription: {
              id: 'subscription-id',
              status: SubscriptionStatus.ACTIVE,
              plan: { name: 'Essential 50' },
            },
          },
        }),
      },
    };
    const service = makeService(prisma as never);
    const stripe = (service as unknown as { stripe: Stripe }).stripe;
    (stripe as unknown as { checkout: { sessions: { retrieve: jest.Mock } } }).checkout = {
      sessions: { retrieve: jest.fn().mockResolvedValue(session) },
    };
    const finalize = jest
      .spyOn(
        service as unknown as {
          finalizeInvoiceCheckout(
            providerEventId: string,
            eventType: string,
            checkout: Stripe.Checkout.Session,
          ): Promise<void>;
        },
        'finalizeInvoiceCheckout',
      )
      .mockResolvedValue();

    await expect(service.getAuthenticatedCheckoutStatus(session.id, actor)).resolves.toEqual({
      checkoutStatus: 'complete',
      stripePaymentStatus: 'paid',
      paymentStatus: PaymentStatus.SUCCEEDED,
      invoiceStatus: InvoiceStatus.PAID,
      subscription: {
        id: 'subscription-id',
        status: SubscriptionStatus.ACTIVE,
        plan: { name: 'Essential 50' },
      },
    });
    expect(finalize).toHaveBeenCalledWith(
      `reconcile:${session.id}`,
      'server.checkout_reconciliation',
      session,
    );
    expect(prisma.payment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ customer: { userId: actor.id } }),
      }),
    );
  });

  it('does not retrieve or disclose a Checkout Session that is not owned by the customer', async () => {
    const service = makeService({
      payment: { findFirst: jest.fn().mockResolvedValue(null) },
    } as never);
    const stripe = (service as unknown as { stripe: Stripe }).stripe;
    const retrieve = jest.fn();
    (stripe as unknown as { checkout: { sessions: { retrieve: jest.Mock } } }).checkout = {
      sessions: { retrieve },
    };

    await expect(
      service.getAuthenticatedCheckoutStatus('cs_test_another_customer', {
        id: 'customer-user-id',
        email: 'customer@merotelecom.test',
        role: Role.CUSTOMER,
      }),
    ).rejects.toThrow('Checkout status not found.');
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('creates a public Checkout from authoritative plan data without creating an account early', async () => {
    const planId = '4ccdfc07-0bac-40e6-93fe-728d00740379';
    const plan = {
      id: planId,
      name: 'Home Plus',
      monthlyCents: 8900,
      stripePriceId: 'price_test_home_plus',
      isActive: true,
      isPublic: true,
      isAvailable: true,
    };
    const application = {
      id: '8deea970-2e1f-44a8-b645-b72882631251',
      amountCents: 8900,
      currency: 'AUD',
    };
    const prisma = {
      internetPlan: { findUnique: jest.fn().mockResolvedValue(plan) },
      user: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
      customer: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
      checkoutApplication: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(application),
        update: jest.fn().mockResolvedValue(application),
      },
    };
    const { publicCheckoutContext, service } = makePublicService(prisma as never);
    const stripe = (service as unknown as { stripe: Stripe }).stripe;
    const create = jest.fn().mockResolvedValue({
      id: 'cs_test_public_123',
      url: 'https://checkout.stripe.test/public-123',
    });
    (stripe as unknown as { checkout: { sessions: { create: jest.Mock } } }).checkout = {
      sessions: { create },
    };
    await expect(
      service.createPublicPlanCheckoutSession(
        {
          planId,
          firstName: 'New',
          lastName: 'Customer',
          email: 'NEW.CUSTOMER@example.com',
          phone: '+61400000009',
          residentialSameAsService: true,
          billingSameAsResidential: true,
          termsAccepted: true,
          privacyAccepted: true,
        },
        'c'.repeat(43),
      ),
    ).resolves.toEqual({ checkoutUrl: 'https://checkout.stripe.test/public-123' });

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.customer.create).not.toHaveBeenCalled();
    expect(publicCheckoutContext.consume).toHaveBeenCalledWith('c'.repeat(43), planId);
    expect(prisma.checkoutApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          applicantEmail: 'new.customer@example.com',
          amountCents: 8900,
        }),
      }),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        customer_email: 'new.customer@example.com',
        line_items: [expect.objectContaining({ price: 'price_test_home_plus' })],
      }),
      { idempotencyKey: `public-plan-checkout-${application.id}` },
    );
  });

  it('resolves separate residential and billing addresses only from trusted tokens', async () => {
    const planId = '4ccdfc07-0bac-40e6-93fe-728d00740379';
    const application = {
      id: '8deea970-2e1f-44a8-b645-b72882631251',
      amountCents: 8900,
      currency: 'AUD',
    };
    const prisma = {
      internetPlan: {
        findUnique: jest.fn().mockResolvedValue({
          id: planId,
          name: 'Home Plus',
          monthlyCents: 8900,
          stripePriceId: 'price_test_home_plus',
          isActive: true,
          isPublic: true,
          isAvailable: true,
        }),
      },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      customer: { findUnique: jest.fn().mockResolvedValue(null) },
      checkoutApplication: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(application),
        update: jest.fn().mockResolvedValue(application),
      },
    };
    const { addressSelections, service } = makePublicService(prisma as never);
    addressSelections.consume
      .mockResolvedValueOnce({
        ...trustedAddress,
        providerAddressId: 'residential-id',
        houseNumber: '2',
        street: 'Residential Road',
      })
      .mockResolvedValueOnce({
        ...trustedAddress,
        providerAddressId: 'billing-id',
        houseNumber: '3',
        street: 'Billing Road',
      });
    const stripe = (service as unknown as { stripe: Stripe }).stripe;
    (stripe as unknown as { checkout: { sessions: { create: jest.Mock } } }).checkout = {
      sessions: {
        create: jest.fn().mockResolvedValue({
          id: 'cs_test_public_separate',
          url: 'https://checkout.stripe.test/public-separate',
        }),
      },
    };

    await service.createPublicPlanCheckoutSession(
      {
        planId,
        firstName: 'Different',
        lastName: 'Addresses',
        email: 'different.addresses@example.com',
        phone: '+61400000009',
        residentialSameAsService: false,
        residentialAddressToken: 'r'.repeat(43),
        billingSameAsResidential: false,
        billingAddressToken: 'b'.repeat(43),
        termsAccepted: true,
        privacyAccepted: true,
      },
      'c'.repeat(43),
    );

    expect(addressSelections.consume).toHaveBeenNthCalledWith(1, 'r'.repeat(43));
    expect(addressSelections.consume).toHaveBeenNthCalledWith(2, 'b'.repeat(43));
    expect(prisma.checkoutApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          residentialAddress: expect.objectContaining({ addressLine1: '2 Residential Road' }),
          serviceAddress: expect.objectContaining({ addressLine1: '9 Test Street' }),
          billingAddress: expect.objectContaining({ addressLine1: '3 Billing Road' }),
        }),
      }),
    );
  });

  it('creates one pending customer account and active subscription after a paid public webhook', async () => {
    const planId = '4ccdfc07-0bac-40e6-93fe-728d00740379';
    const applicationId = '8deea970-2e1f-44a8-b645-b72882631251';
    const address = {
      addressLine1: '9 Test Street',
      addressLine2: null,
      suburb: 'Sydney',
      state: 'NSW',
      postcode: '2000',
    };
    const application = {
      id: applicationId,
      planId,
      applicantEmail: 'new.customer@example.com',
      firstName: 'New',
      lastName: 'Customer',
      phone: '+61400000009',
      residentialAddress: address,
      serviceAddress: address,
      billingAddress: address,
      amountCents: 8900,
      currency: 'AUD',
      status: CheckoutApplicationStatus.PENDING_PAYMENT,
      stripeCheckoutSessionId: 'cs_test_public_123',
      plan: {
        id: planId,
        name: 'Home Plus',
        isActive: true,
        isPublic: true,
        isAvailable: true,
      },
    };
    const transaction = {
      paymentWebhookEvent: {
        findUnique: jest.fn().mockResolvedValueOnce(null).mockResolvedValue({ id: 'event-row' }),
        create: jest.fn().mockResolvedValue({ id: 'event-row' }),
      },
      checkoutApplication: {
        findUnique: jest.fn().mockResolvedValue(application),
        update: jest.fn().mockResolvedValue({}),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'new-user-id' }),
      },
      customer: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: customerId,
          firstName: 'New',
          lastName: 'Customer',
          email: 'new.customer@example.com',
        }),
      },
      subscription: {
        create: jest.fn().mockResolvedValue({ id: 'new-subscription-id' }),
      },
      serviceAddress: {
        create: jest.fn().mockResolvedValue({ id: 'new-service-address-id' }),
      },
      invoice: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: invoiceId,
          totalCents: 8900,
          currency: 'AUD',
        }),
      },
      payment: {
        create: jest.fn().mockResolvedValue({ id: 'new-payment-id', amountCents: 8900 }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({ count: 4 }),
      },
      $executeRaw: jest.fn(),
    };
    const prisma = {
      $transaction: jest.fn((operation) => operation(transaction)),
      paymentWebhookEvent: { findUnique: jest.fn() },
      subscription: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const { invitations, notifications, service } = makePublicService(prisma as never);
    const payload = JSON.stringify({
      id: 'evt_public_paid_001',
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_public_123',
          object: 'checkout.session',
          payment_status: 'paid',
          amount_total: 8900,
          currency: 'aud',
          client_reference_id: applicationId,
          customer: 'cus_test_public_123',
          customer_details: { email: 'new.customer@example.com' },
          payment_intent: 'pi_test_public_123',
          subscription: 'sub_test_recurring',
          invoice: 'in_test_recurring',
          metadata: {
            checkoutKind: 'public_subscription',
            checkoutApplicationId: applicationId,
            planId,
          },
        },
      },
    });
    const stripe = (service as unknown as { stripe: Stripe }).stripe;
    const recurringUpdates = mockRecurringResources(service, 'pi_test_public_123');
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: stripeSecret });

    await service.processStripeWebhook(Buffer.from(payload), signature);
    await service.processStripeWebhook(Buffer.from(payload), signature);

    expect(transaction.user.create).toHaveBeenCalledTimes(1);
    expect(transaction.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        passwordHash: null,
        status: UserStatus.INVITATION_PENDING,
        isActive: false,
      }),
    });
    expect(transaction.customer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: CustomerStatus.INVITATION_PENDING }),
    });
    expect(transaction.subscription.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: SubscriptionStatus.ACTIVE,
        stripePaymentMethodId: 'pm_test_card',
      }),
    });
    expect(recurringUpdates.customerUpdate).toHaveBeenCalledWith(
      'cus_test_public_123',
      { invoice_settings: { default_payment_method: 'pm_test_card' } },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(recurringUpdates.subscriptionUpdate).toHaveBeenCalledWith(
      'sub_test_recurring',
      {
        default_payment_method: 'pm_test_card',
        payment_settings: { save_default_payment_method: 'on_subscription' },
      },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
      where: { stripeSubscriptionId: 'sub_test_recurring' },
      data: expect.objectContaining({ stripePaymentMethodId: 'pm_test_card' }),
    });
    expect(
      new Set(
        recurringUpdates.customerUpdate.mock.calls.map(
          (call: unknown[]) => (call[2] as Stripe.RequestOptions).idempotencyKey,
        ),
      ).size,
    ).toBe(1);
    expect(transaction.invoice.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        subscriptionId: 'new-subscription-id',
        billingPeriodStart: expect.any(Date),
        billingPeriodEnd: expect.any(Date),
      }),
    });
    expect(invitations.queueDelivery).toHaveBeenCalledTimes(1);
    expect(notifications.sendSubscriptionConfirmation).toHaveBeenCalledTimes(1);
  });

  it('records an expired public Checkout without creating a customer or subscription', async () => {
    const applicationId = '8deea970-2e1f-44a8-b645-b72882631251';
    const transaction = {
      paymentWebhookEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'event-row' }),
      },
      checkoutApplication: {
        findUnique: jest.fn().mockResolvedValue({
          id: applicationId,
          stripeCheckoutSessionId: 'cs_test_expired_123',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: { create: jest.fn() },
      customer: { create: jest.fn() },
      subscription: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn((operation) => operation(transaction)),
    };
    const { service } = makePublicService(prisma as never);
    const payload = JSON.stringify({
      id: 'evt_public_expired_001',
      object: 'event',
      type: 'checkout.session.expired',
      data: {
        object: {
          id: 'cs_test_expired_123',
          object: 'checkout.session',
          payment_status: 'unpaid',
          client_reference_id: applicationId,
          metadata: {
            checkoutKind: 'public_subscription',
            checkoutApplicationId: applicationId,
          },
        },
      },
    });
    const stripe = (service as unknown as { stripe: Stripe }).stripe;
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: stripeSecret });

    await service.processStripeWebhook(Buffer.from(payload), signature);

    expect(transaction.checkoutApplication.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: CheckoutApplicationStatus.EXPIRED } }),
    );
    expect(transaction.user.create).not.toHaveBeenCalled();
    expect(transaction.customer.create).not.toHaveBeenCalled();
    expect(transaction.subscription.create).not.toHaveBeenCalled();
  });

  it('creates a plan Checkout from the selected server-side plan without assigning it early', async () => {
    const planId = '4ccdfc07-0bac-40e6-93fe-728d00740379';
    const customer = {
      id: customerId,
      userId: 'customer-user-id',
      email: 'customer@merotelecom.test',
      status: CustomerStatus.ACTIVE,
    };
    const plan = {
      id: planId,
      name: 'Home Plus',
      monthlyCents: 8900,
      stripePriceId: 'price_test_home_plus',
      isActive: true,
      isPublic: true,
      isAvailable: true,
    };
    const purchaseInvoice = {
      id: invoiceId,
      customerId,
      purchasePlanId: planId,
      invoiceNumber: 'INV-2026-000004',
      totalCents: 8900,
      currency: 'AUD',
      status: InvoiceStatus.ISSUED,
      customer,
      purchasePlan: plan,
      payments: [],
    };
    const transaction = {
      $executeRaw: jest.fn(),
      subscription: { count: jest.fn().mockResolvedValue(0), create: jest.fn() },
      internetPlan: { findUnique: jest.fn().mockResolvedValue(plan) },
      invoice: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(purchaseInvoice),
      },
    };
    const prisma = {
      customer: { findUnique: jest.fn().mockResolvedValue(customer) },
      internetPlan: { findUnique: jest.fn().mockResolvedValue(plan) },
      subscription: { count: jest.fn().mockResolvedValue(0) },
      invoice: { findFirst: jest.fn().mockResolvedValue(null) },
      payment: { upsert: jest.fn().mockResolvedValue({ id: 'payment-id' }) },
      $transaction: jest.fn((operation) => operation(transaction)),
    };
    const service = makeService(prisma as never);
    const stripe = (service as unknown as { stripe: Stripe }).stripe;
    const create = jest.fn().mockResolvedValue({
      id: 'cs_plan_123',
      url: 'https://checkout.stripe.test/plan-123',
    });
    (stripe as unknown as { checkout: { sessions: { create: jest.Mock } } }).checkout = {
      sessions: { create },
    };

    await expect(
      service.createPlanCheckoutSession(planId, {
        id: 'customer-user-id',
        email: customer.email,
        role: Role.CUSTOMER,
      }),
    ).resolves.toEqual({
      checkoutUrl: 'https://checkout.stripe.test/plan-123',
      paymentId: 'payment-id',
    });

    expect(transaction.subscription.create).not.toHaveBeenCalled();
    expect(transaction.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ customerId, purchasePlanId: planId, totalCents: 8900 }),
      }),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { checkoutKind: 'plan_purchase', invoiceId, customerId, planId },
        line_items: [expect.objectContaining({ price: 'price_test_home_plus' })],
      }),
      { idempotencyKey: `plan-checkout-${invoiceId}` },
    );
  });

  it('creates Checkout from server-side invoice values and never caller-supplied money', async () => {
    const prisma = {
      invoice: {
        findFirst: jest.fn().mockResolvedValue({
          id: invoiceId,
          customerId,
          invoiceNumber: 'INV-2026-000002',
          totalCents: 6900,
          currency: 'AUD',
          status: InvoiceStatus.ISSUED,
          customer: { email: 'customer@merotelecom.test' },
        }),
      },
      payment: {
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'payment-id' }),
      },
    };
    const service = makeService(prisma);
    const stripe = (service as unknown as { stripe: Stripe }).stripe;
    const create = jest
      .fn()
      .mockResolvedValue({ id: 'cs_test_123', url: 'https://checkout.stripe.test/123' });
    (stripe as unknown as { checkout: { sessions: { create: jest.Mock } } }).checkout = {
      sessions: { create },
    };

    await expect(
      service.createCheckoutSession(invoiceId, {
        id: 'customer-user-id',
        email: 'customer@merotelecom.test',
        role: Role.CUSTOMER,
      }),
    ).resolves.toEqual({
      checkoutUrl: 'https://checkout.stripe.test/123',
      paymentId: 'payment-id',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        client_reference_id: invoiceId,
        integration_identifier: expect.stringMatching(/^mero_telecom_invoice_[a-z]{8}$/),
        metadata: { invoiceId, customerId },
        line_items: [
          expect.objectContaining({ price_data: expect.objectContaining({ unit_amount: 6900 }) }),
        ],
      }),
      { idempotencyKey: expect.stringMatching(new RegExp(`^invoice-checkout-${invoiceId}-`)) },
    );
  });

  it('verifies a signed event and handles a repeated event without duplicate updates', async () => {
    const transaction = {
      paymentWebhookEvent: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 'already-processed' }),
        create: jest.fn().mockResolvedValue({ id: 'event-row-id' }),
      },
      invoice: {
        findUnique: jest.fn().mockResolvedValue({
          id: invoiceId,
          customerId,
          totalCents: 6900,
          currency: 'AUD',
        }),
        update: jest.fn().mockResolvedValue({ id: invoiceId, status: InvoiceStatus.PAID }),
      },
      payment: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'payment-id',
          invoiceId,
          customerId,
          status: PaymentStatus.PENDING,
        }),
        update: jest.fn().mockResolvedValue({ id: 'payment-id', status: PaymentStatus.SUCCEEDED }),
      },
    };
    const prisma = { $transaction: jest.fn((operation) => operation(transaction)) };
    const service = makeService(prisma);
    const payload = JSON.stringify({
      id: 'evt_phase13_001',
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_123',
          object: 'checkout.session',
          payment_status: 'paid',
          amount_total: 6900,
          currency: 'aud',
          client_reference_id: invoiceId,
          payment_intent: 'pi_test_123',
          metadata: { invoiceId, customerId },
        },
      },
    });
    const stripe = (service as unknown as { stripe: Stripe }).stripe;
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: stripeSecret });

    await service.processStripeWebhook(Buffer.from(payload), signature);
    await service.processStripeWebhook(Buffer.from(payload), signature);

    expect(transaction.payment.update).toHaveBeenCalledTimes(1);
    expect(transaction.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: InvoiceStatus.PAID }) }),
    );
    expect(transaction.paymentWebhookEvent.create).toHaveBeenCalledTimes(1);
  });

  it('atomically activates a selected plan when its signed payment webhook succeeds', async () => {
    const planId = '4ccdfc07-0bac-40e6-93fe-728d00740379';
    const transaction = {
      paymentWebhookEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'event-row-id' }),
      },
      invoice: {
        findUnique: jest.fn().mockResolvedValue({
          id: invoiceId,
          customerId,
          purchasePlanId: planId,
          purchasePlan: { id: planId },
          totalCents: 8900,
          currency: 'AUD',
        }),
        update: jest.fn().mockResolvedValue({ id: invoiceId, status: InvoiceStatus.PAID }),
      },
      payment: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'payment-id',
          invoiceId,
          customerId,
          status: PaymentStatus.PENDING,
        }),
        update: jest.fn().mockResolvedValue({ id: 'payment-id', status: PaymentStatus.SUCCEEDED }),
      },
      subscription: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'activated-subscription-id' }),
      },
      customer: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const service = makeService({
      $transaction: jest.fn((operation) => operation(transaction)),
      subscription: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    } as never);
    const payload = JSON.stringify({
      id: 'evt_plan_purchase_001',
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_plan_123',
          object: 'checkout.session',
          payment_status: 'paid',
          amount_total: 8900,
          currency: 'aud',
          client_reference_id: invoiceId,
          payment_intent: 'pi_plan_123',
          customer: 'cus_test_plan_123',
          subscription: 'sub_test_recurring',
          invoice: 'in_test_recurring',
          metadata: { checkoutKind: 'plan_purchase', invoiceId, customerId, planId },
        },
      },
    });
    const stripe = (service as unknown as { stripe: Stripe }).stripe;
    mockRecurringResources(service, 'pi_plan_123');
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: stripeSecret });

    await service.processStripeWebhook(Buffer.from(payload), signature);

    expect(transaction.subscription.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customerId,
        planId,
        status: SubscriptionStatus.ACTIVE,
      }),
    });
    expect(transaction.invoice.update).toHaveBeenCalledWith({
      where: { id: invoiceId },
      data: expect.objectContaining({
        status: InvoiceStatus.PAID,
        subscriptionId: 'activated-subscription-id',
        billingPeriodStart: expect.any(Date),
        billingPeriodEnd: expect.any(Date),
      }),
    });
    expect(transaction.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: PaymentStatus.SUCCEEDED }),
      }),
    );
  });

  it('records a distinct valid event for an already-succeeded Checkout Session', async () => {
    const transaction = {
      paymentWebhookEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'second-event-row' }),
      },
      invoice: {
        findUnique: jest.fn().mockResolvedValue({
          id: invoiceId,
          customerId,
          totalCents: 6900,
          currency: 'AUD',
        }),
        update: jest.fn(),
      },
      payment: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'payment-id',
          invoiceId,
          customerId,
          status: PaymentStatus.SUCCEEDED,
        }),
        update: jest.fn(),
      },
    };
    const service = makeService({
      $transaction: jest.fn((operation) => operation(transaction)),
    } as never);
    const payload = JSON.stringify({
      id: 'evt_phase16_distinct',
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_123',
          object: 'checkout.session',
          payment_status: 'paid',
          amount_total: 6900,
          currency: 'aud',
          client_reference_id: invoiceId,
          metadata: { invoiceId, customerId },
        },
      },
    });
    const stripe = (service as unknown as { stripe: Stripe }).stripe;
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: stripeSecret });

    await service.processStripeWebhook(Buffer.from(payload), signature);

    expect(transaction.payment.update).not.toHaveBeenCalled();
    expect(transaction.invoice.update).not.toHaveBeenCalled();
    expect(transaction.paymentWebhookEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ paymentId: 'payment-id' }) }),
    );
  });

  it('mirrors a recurring invoice payment once when Stripe retries the webhook', async () => {
    const transaction = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      paymentWebhookEvent: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 'processed-event' }),
        create: jest.fn().mockResolvedValue({ id: 'processed-event' }),
      },
      invoice: {
        findUnique: jest.fn().mockResolvedValue({
          id: invoiceId,
          customerId,
          subscriptionId: 'subscription-id',
          currency: 'AUD',
        }),
        update: jest.fn().mockResolvedValue({ id: invoiceId }),
      },
      payment: {
        upsert: jest.fn().mockResolvedValue({ id: 'renewal-payment-id' }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = makeService({
      $transaction: jest.fn((operation) => operation(transaction)),
    } as never);
    jest
      .spyOn(
        service as unknown as {
          ensureStripeRecurringInvoice(
            invoice: Stripe.Invoice,
            status: InvoiceStatus,
          ): Promise<string | null>;
        },
        'ensureStripeRecurringInvoice',
      )
      .mockResolvedValue(invoiceId);
    const payload = JSON.stringify({
      id: 'evt_recurring_paid_001',
      object: 'event',
      created: 1_788_220_800,
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_test_renewal',
          object: 'invoice',
          amount_paid: 8900,
          currency: 'aud',
          hosted_invoice_url: 'https://invoice.stripe.test/renewal',
          invoice_pdf: 'https://invoice.stripe.test/renewal.pdf',
        },
      },
    });
    const stripe = (service as unknown as { stripe: Stripe }).stripe;
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: stripeSecret });

    await service.processStripeWebhook(Buffer.from(payload), signature);
    await service.processStripeWebhook(Buffer.from(payload), signature);

    expect(transaction.payment.upsert).toHaveBeenCalledTimes(1);
    expect(transaction.invoice.update).toHaveBeenCalledTimes(1);
    expect(transaction.paymentWebhookEvent.create).toHaveBeenCalledTimes(1);
    expect(transaction.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('rejects an event whose signature cannot be verified', async () => {
    const service = makeService({});
    await expect(
      service.processStripeWebhook(Buffer.from('{"id":"evt_invalid"}'), 't=1,v1=invalid'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('routes a signed invoice payment failure into the overdue lifecycle', async () => {
    const service = makeService({});
    const payload = JSON.stringify({
      id: 'evt_invoice_payment_failed',
      object: 'event',
      type: 'checkout.session.async_payment_failed',
      data: {
        object: {
          id: 'cs_failed_invoice',
          object: 'checkout.session',
          payment_status: 'unpaid',
          amount_total: 9_900,
          currency: 'aud',
          client_reference_id: invoiceId,
          metadata: { invoiceId, customerId },
        },
      },
    });
    const stripe = (service as unknown as { stripe: Stripe }).stripe;
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: stripeSecret });

    await service.processStripeWebhook(Buffer.from(payload), signature);

    const lifecycle = (
      service as unknown as {
        subscriptionLifecycle: { handlePaymentFailure: jest.Mock };
      }
    ).subscriptionLifecycle;
    expect(lifecycle.handlePaymentFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        providerEventId: 'evt_invoice_payment_failed',
        invoiceId,
        providerSessionId: 'cs_failed_invoice',
      }),
    );
  });

  it('returns only masked payment method details and protects the only recurring method', async () => {
    const service = makeService({
      customer: {
        findUnique: jest.fn().mockResolvedValue({
          id: customerId,
          userId: 'customer-user-id',
          stripeCustomerId: 'cus_owned',
        }),
      },
      subscription: { count: jest.fn().mockResolvedValue(1) },
    } as never);
    const stripe = (service as unknown as { stripe: Stripe }).stripe as unknown as {
      customers: { retrieve: jest.Mock };
      paymentMethods: { list: jest.Mock };
    };
    stripe.customers.retrieve = jest.fn().mockResolvedValue({
      id: 'cus_owned',
      invoice_settings: { default_payment_method: 'pm_owned' },
    });
    stripe.paymentMethods.list = jest.fn().mockResolvedValue({
      data: [
        {
          id: 'pm_owned',
          type: 'card',
          card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 },
        },
      ],
    });

    const result = await service.getPaymentMethods({ id: 'customer-user-id' } as never);

    expect(result.paymentMethods).toEqual([
      expect.objectContaining({
        id: 'pm_owned',
        brand: 'visa',
        last4: '4242',
        isDefault: true,
        canRemove: false,
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain('4242424242424242');
    expect(stripe.paymentMethods.list).toHaveBeenCalledWith({
      customer: 'cus_owned',
      limit: 100,
    });
  });

  it('returns a reusable Link payment method instead of filtering it out as a non-card', async () => {
    const service = makeService({
      customer: {
        findUnique: jest.fn().mockResolvedValue({
          id: customerId,
          userId: 'customer-user-id',
          stripeCustomerId: 'cus_owned',
        }),
      },
      subscription: { count: jest.fn().mockResolvedValue(1) },
    } as never);
    const stripe = (service as unknown as { stripe: Stripe }).stripe as unknown as {
      customers: { retrieve: jest.Mock };
      paymentMethods: { list: jest.Mock };
    };
    stripe.customers.retrieve = jest.fn().mockResolvedValue({
      id: 'cus_owned',
      invoice_settings: { default_payment_method: 'pm_link' },
    });
    stripe.paymentMethods.list = jest.fn().mockResolvedValue({
      data: [{ id: 'pm_link', type: 'link', card: null }],
    });

    const result = await service.getPaymentMethods({ id: 'customer-user-id' } as never);

    expect(result.paymentMethods).toEqual([
      expect.objectContaining({
        id: 'pm_link',
        type: 'link',
        brand: null,
        last4: null,
        isDefault: true,
        canRemove: false,
      }),
    ]);
    expect(stripe.paymentMethods.list).toHaveBeenCalledWith({
      customer: 'cus_owned',
      limit: 100,
    });
  });

  it('blocks removal of the only payment method for a protected recurring subscription', async () => {
    const service = makeService({
      customer: {
        findUnique: jest.fn().mockResolvedValue({
          id: customerId,
          userId: 'customer-user-id',
          stripeCustomerId: 'cus_owned',
        }),
      },
      subscription: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'subscription-id', stripeSubscriptionId: 'sub_owned' }]),
      },
    } as never);
    const stripe = (service as unknown as { stripe: Stripe }).stripe as unknown as {
      customers: { retrieve: jest.Mock };
      paymentMethods: { retrieve: jest.Mock; list: jest.Mock; detach: jest.Mock };
    };
    stripe.paymentMethods.retrieve = jest.fn().mockResolvedValue({
      id: 'pm_owned',
      customer: 'cus_owned',
      type: 'card',
      card: { brand: 'visa', last4: '4242' },
    });
    stripe.paymentMethods.list = jest.fn().mockResolvedValue({ data: [{ id: 'pm_owned' }] });
    stripe.paymentMethods.detach = jest.fn();
    stripe.customers.retrieve = jest.fn().mockResolvedValue({
      id: 'cus_owned',
      invoice_settings: { default_payment_method: 'pm_owned' },
    });

    await expect(
      service.removePaymentMethod('pm_owned', { id: 'customer-user-id' } as never),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(stripe.paymentMethods.detach).not.toHaveBeenCalled();
  });

  it('creates a Customer Portal session only for the authenticated customer', async () => {
    const service = makeService({
      customer: {
        findUnique: jest.fn().mockResolvedValue({
          id: customerId,
          userId: 'customer-user-id',
          stripeCustomerId: 'cus_owned',
        }),
      },
    } as never);
    const stripe = (service as unknown as { stripe: Stripe }).stripe as unknown as {
      billingPortal: { sessions: { create: jest.Mock } };
    };
    stripe.billingPortal.sessions.create = jest.fn().mockResolvedValue({
      url: 'https://billing.stripe.test/session',
    });

    await expect(
      service.createCustomerPortalSession({ id: 'customer-user-id' } as never),
    ).resolves.toEqual({ portalUrl: 'https://billing.stripe.test/session' });
    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_owned',
        return_url: 'http://localhost:3000/customer/subscription?paymentMethod=updated',
      }),
    );
  });

  it('refuses to set a payment method owned by another Stripe customer', async () => {
    const service = makeService({
      customer: {
        findUnique: jest.fn().mockResolvedValue({
          id: customerId,
          userId: 'customer-user-id',
          stripeCustomerId: 'cus_owned',
        }),
      },
    } as never);
    const stripe = (service as unknown as { stripe: Stripe }).stripe as unknown as {
      customers: { update: jest.Mock };
      paymentMethods: { retrieve: jest.Mock };
    };
    stripe.paymentMethods.retrieve = jest.fn().mockResolvedValue({
      id: 'pm_other',
      customer: 'cus_other',
      type: 'card',
      card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 },
    });
    stripe.customers.update = jest.fn();

    await expect(
      service.setDefaultPaymentMethod('pm_other', { id: 'customer-user-id' } as never),
    ).rejects.toThrow('Payment method not found for this account.');
    expect(stripe.customers.update).not.toHaveBeenCalled();
  });

  it('changes the customer and recurring subscription default without creating billing records', async () => {
    const transaction = {
      subscription: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({
          id: customerId,
          userId: 'customer-user-id',
          stripeCustomerId: 'cus_owned',
        }),
      },
      subscription: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'subscription-id', stripeSubscriptionId: 'sub_owned' }]),
      },
      invoice: { findMany: jest.fn().mockResolvedValue([]) },
      payment: { create: jest.fn() },
      $transaction: jest.fn((operation) => operation(transaction)),
    };
    const service = makeService(prisma as never);
    const stripe = (service as unknown as { stripe: Stripe }).stripe as unknown as {
      customers: { update: jest.Mock };
      paymentMethods: { retrieve: jest.Mock };
      subscriptions: { update: jest.Mock };
    };
    stripe.paymentMethods.retrieve = jest.fn().mockResolvedValue({
      id: 'pm_replacement',
      customer: 'cus_owned',
      type: 'card',
      card: { brand: 'mastercard', last4: '4444', exp_month: 10, exp_year: 2031 },
    });
    stripe.customers.update = jest.fn().mockResolvedValue({ id: 'cus_owned' });
    stripe.subscriptions.update = jest.fn().mockResolvedValue({ id: 'sub_owned' });

    await expect(
      service.setDefaultPaymentMethod('pm_replacement', { id: 'customer-user-id' } as never),
    ).resolves.toEqual({ updated: true });
    expect(stripe.customers.update).toHaveBeenCalledWith(
      'cus_owned',
      { invoice_settings: { default_payment_method: 'pm_replacement' } },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(stripe.subscriptions.update).toHaveBeenCalledWith(
      'sub_owned',
      { default_payment_method: 'pm_replacement' },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('removes a non-default card without changing or cancelling the recurring subscription', async () => {
    const transaction = {
      subscription: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = makeService({
      customer: {
        findUnique: jest.fn().mockResolvedValue({
          id: customerId,
          userId: 'customer-user-id',
          stripeCustomerId: 'cus_owned',
        }),
      },
      subscription: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'subscription-id', stripeSubscriptionId: 'sub_owned' }]),
      },
      $transaction: jest.fn((operation) => operation(transaction)),
    } as never);
    const stripe = (service as unknown as { stripe: Stripe }).stripe as unknown as {
      customers: { retrieve: jest.Mock; update: jest.Mock };
      paymentMethods: { retrieve: jest.Mock; list: jest.Mock; detach: jest.Mock };
      subscriptions: { cancel: jest.Mock };
    };
    stripe.paymentMethods.retrieve = jest.fn().mockResolvedValue({
      id: 'pm_old',
      customer: 'cus_owned',
      type: 'card',
      card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 },
    });
    stripe.paymentMethods.list = jest
      .fn()
      .mockResolvedValue({ data: [{ id: 'pm_default' }, { id: 'pm_old' }] });
    stripe.paymentMethods.detach = jest.fn().mockResolvedValue({ id: 'pm_old' });
    stripe.customers.retrieve = jest.fn().mockResolvedValue({
      id: 'cus_owned',
      invoice_settings: { default_payment_method: 'pm_default' },
    });
    stripe.customers.update = jest.fn();
    stripe.subscriptions.cancel = jest.fn();

    await expect(
      service.removePaymentMethod('pm_old', { id: 'customer-user-id' } as never),
    ).resolves.toEqual({ removed: true });
    expect(stripe.paymentMethods.detach).toHaveBeenCalledTimes(1);
    expect(stripe.customers.update).not.toHaveBeenCalled();
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it('allows the final card to be removed after the recurring subscription is no longer current', async () => {
    const transaction = {
      subscription: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = makeService({
      customer: {
        findUnique: jest.fn().mockResolvedValue({
          id: customerId,
          userId: 'customer-user-id',
          stripeCustomerId: 'cus_owned',
        }),
      },
      subscription: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((operation) => operation(transaction)),
    } as never);
    const stripe = (service as unknown as { stripe: Stripe }).stripe as unknown as {
      customers: { retrieve: jest.Mock; update: jest.Mock };
      paymentMethods: { retrieve: jest.Mock; list: jest.Mock; detach: jest.Mock };
    };
    stripe.paymentMethods.retrieve = jest.fn().mockResolvedValue({
      id: 'pm_final',
      customer: 'cus_owned',
      type: 'card',
      card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 },
    });
    stripe.paymentMethods.list = jest.fn().mockResolvedValue({ data: [{ id: 'pm_final' }] });
    stripe.paymentMethods.detach = jest.fn().mockResolvedValue({ id: 'pm_final' });
    stripe.customers.retrieve = jest.fn().mockResolvedValue({
      id: 'cus_owned',
      invoice_settings: { default_payment_method: 'pm_final' },
    });
    stripe.customers.update = jest.fn().mockResolvedValue({ id: 'cus_owned' });

    await expect(
      service.removePaymentMethod('pm_final', { id: 'customer-user-id' } as never),
    ).resolves.toEqual({ removed: true });
    expect(stripe.customers.update).toHaveBeenCalledWith(
      'cus_owned',
      { invoice_settings: { default_payment_method: '' } },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(stripe.paymentMethods.detach).toHaveBeenCalledTimes(1);
  });

  it('synchronizes customer default changes once and retries the same open Stripe invoice', async () => {
    const transaction = {
      paymentWebhookEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'processed-event' }),
      },
      subscription: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      paymentWebhookEvent: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 'processed-event' }),
      },
      customer: {
        findUnique: jest.fn().mockResolvedValue({ id: customerId, stripeCustomerId: 'cus_owned' }),
      },
      subscription: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'subscription-id', stripeSubscriptionId: 'sub_owned' }]),
      },
      invoice: {
        findMany: jest.fn().mockResolvedValue([{ id: invoiceId, stripeInvoiceId: 'in_failed' }]),
      },
      $transaction: jest.fn((operation) => operation(transaction)),
    };
    const service = makeService(prisma as never);
    const stripe = (service as unknown as { stripe: Stripe }).stripe as unknown as {
      paymentMethods: { retrieve: jest.Mock };
      subscriptions: { update: jest.Mock };
      invoices: { pay: jest.Mock };
      webhooks: Stripe['webhooks'];
    };
    stripe.paymentMethods.retrieve = jest.fn().mockResolvedValue({
      id: 'pm_replacement',
      customer: 'cus_owned',
      type: 'card',
      card: { brand: 'mastercard', last4: '4444', exp_month: 10, exp_year: 2031 },
    });
    stripe.subscriptions.update = jest.fn().mockResolvedValue({ id: 'sub_owned' });
    stripe.invoices.pay = jest.fn().mockResolvedValue({ id: 'in_failed', status: 'paid' });
    const payload = JSON.stringify({
      id: 'evt_customer_updated_payment_method',
      object: 'event',
      type: 'customer.updated',
      data: {
        object: {
          id: 'cus_owned',
          object: 'customer',
          invoice_settings: { default_payment_method: 'pm_replacement' },
        },
      },
    });
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: stripeSecret });

    await service.processStripeWebhook(Buffer.from(payload), signature);
    await service.processStripeWebhook(Buffer.from(payload), signature);

    expect(stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(stripe.invoices.pay).toHaveBeenCalledTimes(1);
    expect(stripe.invoices.pay).toHaveBeenCalledWith(
      'in_failed',
      { payment_method: 'pm_replacement' },
      expect.objectContaining({ idempotencyKey: expect.stringContaining(invoiceId) }),
    );
    expect(transaction.paymentWebhookEvent.create).toHaveBeenCalledTimes(1);
  });
});
