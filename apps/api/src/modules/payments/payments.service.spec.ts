import { BadRequestException } from '@nestjs/common';
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
  );
  return { addressSelections, invitations, notifications, publicCheckoutContext, service };
}

describe('PaymentsService', () => {
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
        customer_creation: 'always',
        customer_email: 'new.customer@example.com',
        line_items: [
          expect.objectContaining({ price_data: expect.objectContaining({ unit_amount: 8900 }) }),
        ],
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
          metadata: {
            checkoutKind: 'public_subscription',
            checkoutApplicationId: applicationId,
            planId,
          },
        },
      },
    });
    const stripe = (service as unknown as { stripe: Stripe }).stripe;
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
      data: expect.objectContaining({ status: SubscriptionStatus.ACTIVE }),
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
        line_items: [
          expect.objectContaining({ price_data: expect.objectContaining({ unit_amount: 8900 }) }),
        ],
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
    };
    const service = makeService({
      $transaction: jest.fn((operation) => operation(transaction)),
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
          metadata: { checkoutKind: 'plan_purchase', invoiceId, customerId, planId },
        },
      },
    });
    const stripe = (service as unknown as { stripe: Stripe }).stripe;
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

  it('rejects an event whose signature cannot be verified', async () => {
    const service = makeService({});
    await expect(
      service.processStripeWebhook(Buffer.from('{"id":"evt_invalid"}'), 't=1,v1=invalid'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
