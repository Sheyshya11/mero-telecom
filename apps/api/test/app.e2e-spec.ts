import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AccessTechnology,
  AccountInvitationReason,
  AccountInvitationStatus,
  AddressOverrideStatus,
  CancellationReason,
  CancellationStatus,
  CancellationType,
  CoverageResultStatus,
  InvoiceStatus,
  InternalRequestEventType,
  InternalRequestLevel,
  InternalRequestStatus,
  OperatingRegionStatus,
  PaymentStatus,
  PlanChangeStatus,
  PlanChangeType,
  PostcodeCoverageStatus,
  RefundReason,
  Role,
  SubscriptionStatus,
  SupportMessageVisibility,
  SupportRequestType,
  SupportStatus,
  UserStatus,
} from '@prisma/client';
import { hash } from 'bcryptjs';
import { createHash } from 'node:crypto';
import { createClient } from 'redis';
import Stripe from 'stripe';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/configure-application';
import { PrismaService } from '../src/database/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { CancellationsService } from '../src/modules/cancellations/cancellations.service';
import { EmailProvider } from '../src/modules/notifications/email-provider';
import {
  ADDRESS_LOOKUP_PROVIDER,
  type AddressLookupProvider,
  type NormalizedAddressSuggestion,
} from '../src/modules/coverage/coverage.types';
import { StripeClientService } from '../src/modules/payments/stripe-client.service';
import { PlanChangesService } from '../src/modules/plan-changes/plan-changes.service';
import { RefundsService } from '../src/modules/refunds/refunds.service';

const password = 'ChangeMe123!';
const customerInput = {
  firstName: 'Test',
  lastName: 'Customer',
  email: 'created.customer@merotelecom.test',
  phone: '+61400000009',
  addressLine1: '9 Test Street',
  addressLine2: '',
  suburb: 'Adelaide',
  state: 'SA',
  postcode: '5000',
};

async function clearE2eEmailQueue(): Promise<void> {
  const client = createClient({ url: process.env.REDIS_URL });
  await client.connect();
  try {
    for await (const keys of client.scanIterator({
      MATCH: 'bull:mero-telecom-email*',
      COUNT: 100,
    })) {
      if (keys.length > 0) await client.del(keys);
    }
  } finally {
    client.destroy();
  }
}

const coverageFixtures: Record<string, NormalizedAddressSuggestion> = {
  available: {
    provider: 'geoapify',
    providerAddressId: 'fixture-available-adelaide',
    formattedAddress: '1 North Terrace, Adelaide SA 5000, Australia',
    unit: null,
    houseNumber: '1',
    street: 'North Terrace',
    suburb: 'Adelaide',
    city: 'Adelaide',
    state: 'South Australia',
    stateCode: 'SA',
    postcode: '5000',
    countryCode: 'au',
    latitude: -34.921,
    longitude: 138.599,
  },
  unsupported: {
    provider: 'geoapify',
    providerAddressId: 'fixture-unsupported-adelaide',
    formattedAddress: '1 Test Street, Adelaide SA 5002, Australia',
    unit: null,
    houseNumber: '1',
    street: 'Test Street',
    suburb: 'Adelaide',
    city: 'Adelaide',
    state: 'South Australia',
    stateCode: null,
    postcode: '5002',
    countryCode: 'AU',
    latitude: -34.925,
    longitude: 138.6,
  },
  victoria: {
    provider: 'geoapify',
    providerAddressId: 'fixture-victoria',
    formattedAddress: '1 Collins Street, Melbourne VIC 3000, Australia',
    unit: null,
    houseNumber: '1',
    street: 'Collins Street',
    suburb: 'Melbourne',
    city: 'Melbourne',
    state: 'Victoria',
    stateCode: 'VIC',
    postcode: '3000',
    countryCode: 'au',
    latitude: -37.814,
    longitude: 144.963,
  },
  coming: {
    provider: 'geoapify',
    providerAddressId: 'fixture-coming-soon-sa',
    formattedAddress: '1 Future Road, Gawler SA 5114, Australia',
    unit: null,
    houseNumber: '1',
    street: 'Future Road',
    suburb: 'Gawler',
    city: 'Gawler',
    state: 'South Australia',
    stateCode: 'SA',
    postcode: '5114',
    countryCode: 'au',
    latitude: -34.6,
    longitude: 138.75,
  },
  override: {
    provider: 'geoapify',
    providerAddressId: 'fixture-unavailable-adelaide',
    formattedAddress: '12 King William Street, Adelaide SA 5000, Australia',
    unit: null,
    houseNumber: '12',
    street: 'King William Street',
    suburb: 'Adelaide',
    city: 'Adelaide',
    state: 'South Australia',
    stateCode: 'SA',
    postcode: '5000',
    countryCode: 'au',
    latitude: -34.925,
    longitude: 138.599,
  },
};

const fakeAddressProvider: AddressLookupProvider = {
  search: jest.fn(async (query: string) => {
    const key = query.trim().toLowerCase();
    return coverageFixtures[key] ? [coverageFixtures[key]] : [];
  }),
};

async function waitUntil(
  check: () => Promise<boolean>,
  timeoutMilliseconds = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for asynchronous email delivery.');
}

describe('Mero Telecom API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let superAdminToken: string;
  let superAdminTwoToken: string;
  let staffToken: string;
  let staffTwoToken: string;
  let adminTwoToken: string;
  let customerToken: string;
  let customerBToken: string;
  let customerAId: string;
  let customerBId: string;
  let planId: string;
  let subscriptionAId: string;
  let subscriptionBId: string;
  let upgradedSubscriptionId: string;
  let upgradedPlanId: string;
  let cheaperPlanId: string;
  let invoiceAId: string;
  let invoiceBId: string;
  let invitedCustomerId: string;
  let invitedUserId: string;
  const stripeSessions = new Map<string, Stripe.Checkout.Session>();
  const stripeRefunds = new Map<string, Stripe.Refund>();
  let stripeSessionSequence = 0;
  let stripeRefundSequence = 0;

  const fakeStripeClient = {
    client: {
      checkout: {
        sessions: {
          create: jest.fn(async (input: Stripe.Checkout.SessionCreateParams) => {
            const priceData = input.line_items?.[0] as
              | { price_data?: { currency?: string; unit_amount?: number } }
              | undefined;
            const id = `cs_test_plan_change_${++stripeSessionSequence}`;
            const session = {
              id,
              object: 'checkout.session',
              client_reference_id: input.client_reference_id ?? null,
              metadata: input.metadata ?? {},
              amount_total: priceData?.price_data?.unit_amount ?? null,
              currency: priceData?.price_data?.currency ?? null,
              payment_intent: null,
              payment_status: 'unpaid',
              status: 'open',
              url: `https://checkout.stripe.test/${id}`,
            } as Stripe.Checkout.Session;
            stripeSessions.set(id, session);
            return session;
          }),
          retrieve: jest.fn(async (id: string) => {
            const session = stripeSessions.get(id);
            if (!session) throw new Error(`Unknown fake Stripe session: ${id}`);
            return session;
          }),
        },
      },
      refunds: {
        create: jest.fn(
          async (
            input: Stripe.RefundCreateParams,
            _options: Stripe.RequestOptions,
          ): Promise<Stripe.Refund> => {
            const id = `re_e2e_${++stripeRefundSequence}`;
            const refund = {
              id,
              object: 'refund',
              amount: input.amount,
              balance_transaction: null,
              charge: `ch_e2e_${stripeRefundSequence}`,
              created: Math.floor(Date.now() / 1000),
              currency: 'aud',
              metadata: input.metadata ?? {},
              payment_intent: input.payment_intent,
              reason: input.reason ?? null,
              receipt_number: null,
              source_transfer_reversal: null,
              status: 'pending',
              transfer_reversal: null,
            } as Stripe.Refund;
            stripeRefunds.set(id, refund);
            return refund;
          },
        ),
        retrieve: jest.fn(async (id: string) => {
          const refund = stripeRefunds.get(id);
          if (!refund) throw new Error(`Unknown fake Stripe refund: ${id}`);
          return refund;
        }),
      },
      webhooks: {
        constructEvent: jest.fn((payload: Buffer, signature: string) => {
          if (signature !== 'e2e-valid-signature') throw new Error('Invalid signature');
          return JSON.parse(payload.toString('utf8')) as Stripe.Event;
        }),
      },
    },
  };

  beforeAll(async () => {
    await clearE2eEmailQueue();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ADDRESS_LOOKUP_PROVIDER)
      .useValue(fakeAddressProvider)
      .overrideProvider(EmailProvider)
      .useValue({ send: jest.fn().mockResolvedValue({ messageId: 'e2e-message-id' }) })
      .overrideProvider(StripeClientService)
      .useValue(fakeStripeClient)
      .compile();
    app = module.createNestApplication({ rawBody: true });
    configureApplication(app, { logger: false, swagger: false });
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.coverageSearch.deleteMany();
    await prisma.planCoverageRule.deleteMany();
    await prisma.addressCoverageOverride.deleteMany();
    await prisma.postcodeCoverage.deleteMany();
    await prisma.operatingRegion.deleteMany();
    await prisma.paymentWebhookEvent.deleteMany();
    await prisma.internalRequestAttachment.deleteMany();
    await prisma.internalRequestEvent.deleteMany();
    await prisma.internalRequestMessage.deleteMany();
    await prisma.internalRequest.deleteMany();
    await prisma.internalRequestSequence.deleteMany();
    await prisma.supportAttachment.deleteMany();
    await prisma.supportMessage.deleteMany();
    await prisma.supportCase.deleteMany();
    await prisma.supportCaseSequence.deleteMany();
    await prisma.cancellationNote.deleteMany();
    await prisma.cancellationRequest.deleteMany();
    await prisma.cancellationRequestSequence.deleteMany();
    await prisma.planChangeRequest.deleteMany();
    await prisma.accountInvitation.deleteMany();
    await prisma.staffInvitation.deleteMany();
    await prisma.checkoutApplication.deleteMany();
    await prisma.refund.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.invoiceDocument.deleteMany();
    await prisma.invoiceItem.deleteMany();
    await prisma.invoice.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.customerAddress.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.refreshSession.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.internetPlan.deleteMany();
    await prisma.user.deleteMany();

    const passwordHash = await hash(password, 12);
    const [
      superAdmin,
      superAdminTwo,
      admin,
      adminTwo,
      staff,
      staffTwo,
      customerAUser,
      customerBUser,
    ] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'super.admin@merotelecom.test',
          passwordHash,
          roles: { create: { role: Role.SUPER_ADMIN } },
        },
      }),
      prisma.user.create({
        data: {
          email: 'super.admin-two@merotelecom.test',
          passwordHash,
          roles: { create: { role: Role.SUPER_ADMIN } },
        },
      }),
      prisma.user.create({
        data: {
          email: 'admin@merotelecom.test',
          passwordHash,
          roles: { create: { role: Role.ADMIN } },
        },
      }),
      prisma.user.create({
        data: {
          email: 'admin-two@merotelecom.test',
          passwordHash,
          roles: { create: { role: Role.ADMIN } },
        },
      }),
      prisma.user.create({
        data: {
          email: 'staff@merotelecom.test',
          passwordHash,
          roles: { create: { role: Role.STAFF } },
        },
      }),
      prisma.user.create({
        data: {
          email: 'staff-two@merotelecom.test',
          passwordHash,
          roles: { create: { role: Role.STAFF } },
        },
      }),
      prisma.user.create({
        data: {
          email: 'customer@merotelecom.test',
          passwordHash,
          roles: { create: { role: Role.CUSTOMER } },
        },
      }),
      prisma.user.create({
        data: {
          email: 'customer-b@merotelecom.test',
          passwordHash,
          roles: { create: { role: Role.CUSTOMER } },
        },
      }),
    ]);
    expect(superAdmin.id).toBeDefined();
    expect(superAdminTwo.id).toBeDefined();
    expect(admin.id).toBeDefined();
    expect(adminTwo.id).toBeDefined();
    expect(staff.id).toBeDefined();
    expect(staffTwo.id).toBeDefined();

    const [customerA, customerB] = await Promise.all([
      prisma.customer.create({
        data: {
          userId: customerAUser.id,
          customerNumber: 'CUST-E2E-0001',
          firstName: 'Anika',
          lastName: 'Singh',
          email: customerAUser.email,
          phone: '+61400000001',
          addressLine1: '1 North Terrace',
          suburb: 'Adelaide',
          state: 'SA',
          postcode: '5000',
        },
      }),
      prisma.customer.create({
        data: {
          userId: customerBUser.id,
          customerNumber: 'CUST-E2E-0002',
          firstName: 'Noah',
          lastName: 'Williams',
          email: customerBUser.email,
          phone: '+61400000002',
          addressLine1: '2 North Terrace',
          suburb: 'Adelaide',
          state: 'SA',
          postcode: '5000',
        },
      }),
    ]);
    customerAId = customerA.id;
    customerBId = customerB.id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('handles failed login, refresh rotation, and logout revocation', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@merotelecom.test', password: 'wrong-password' })
      .expect(401);

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@merotelecom.test', password })
      .expect(200);
    const firstCookie = cookieFrom(login.headers['set-cookie']);
    expect(login.body.accessToken).toEqual(expect.any(String));

    const refreshed = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', firstCookie)
      .expect(200);
    const rotatedCookie = cookieFrom(refreshed.headers['set-cookie']);
    const rotatedAccessToken = refreshed.body.accessToken as string;
    expect(rotatedCookie).not.toBe(firstCookie);

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${rotatedAccessToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', firstCookie)
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', rotatedCookie)
      .expect(204);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', rotatedCookie)
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${rotatedAccessToken}`)
      .expect(401);
  });

  it('enforces validation and admin/staff role boundaries', async () => {
    superAdminToken = await loginAs('super.admin@merotelecom.test');
    superAdminTwoToken = await loginDirectAs('super.admin-two@merotelecom.test');
    adminToken = await loginAs('admin@merotelecom.test');
    adminTwoToken = await loginDirectAs('admin-two@merotelecom.test');
    staffToken = await loginAs('staff@merotelecom.test');
    staffTwoToken = await loginDirectAs('staff-two@merotelecom.test');

    await request(app.getHttpServer())
      .post('/api/v1/plans')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ name: 'Forbidden plan', downloadMbps: 10, uploadMbps: 5, monthlyCents: 5000 })
      .expect(403);

    const createdCustomer = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(customerInput)
      .expect(201);
    expect(createdCustomer.body.customerNumber).toMatch(/^CUST-/);
    invitedCustomerId = createdCustomer.body.id;
    const invitedCustomer = await prisma.customer.findUniqueOrThrow({
      where: { id: invitedCustomerId },
      include: { user: { include: { roles: true } }, addresses: true },
    });
    invitedUserId = invitedCustomer.userId as string;
    expect(invitedCustomer.status).toBe('INVITATION_PENDING');
    expect(invitedCustomer.user).toEqual(
      expect.objectContaining({
        roles: [expect.objectContaining({ role: Role.CUSTOMER })],
        status: UserStatus.INVITATION_PENDING,
        isActive: false,
        passwordHash: null,
      }),
    );
    expect(invitedCustomer.addresses).toHaveLength(3);
    await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(customerInput)
      .expect(409);
    await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...customerInput, email: 'invalid' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ ...customerInput, email: 'staff-forbidden@merotelecom.test' })
      .expect(403);

    const staffList = await request(app.getHttpServer())
      .get('/api/v1/customers?search=Anika')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);
    expect(staffList.body.data).toHaveLength(1);
    const staffUpdate = await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerAId}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ firstName: 'Not permitted', phone: '+61400000003' })
      .expect(200);
    expect(staffUpdate.body.firstName).toBe('Anika');
    expect(staffUpdate.body.phone).toBe('+61400000003');
  });

  it('provisions staff only through an admin invitation and rejects public role injection', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/payments/public-plan-checkout-session')
      .send({
        planId: '00000000-0000-4000-8000-000000000001',
        firstName: 'Privilege',
        lastName: 'Attempt',
        email: 'privilege.attempt@example.com',
        phone: '+61400000008',
        residentialSameAsService: true,
        billingSameAsResidential: true,
        termsAccepted: true,
        privacyAccepted: true,
        role: Role.ADMIN,
      })
      .expect(400)
      .expect((response) => {
        expect(response.body.errors.messages).toContain('property role should not exist');
      });

    await request(app.getHttpServer())
      .post('/api/v1/admin/users/invitations')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        displayName: 'Forbidden Invite',
        email: 'forbidden.staff@example.com',
        role: Role.STAFF,
      })
      .expect(403);

    await request(app.getHttpServer())
      .post('/api/v1/admin/users/invitations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        displayName: 'Forbidden Administrator',
        email: 'forbidden.admin@example.com',
        role: Role.ADMIN,
      })
      .expect(403);

    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/users/invitations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        displayName: 'Invited Operator',
        email: 'invited.operator@example.com',
        role: Role.STAFF,
      })
      .expect(201);
    expect(created.body).not.toHaveProperty('tokenHash');
    const invitation = await prisma.staffInvitation.findUniqueOrThrow({
      where: { id: created.body.id },
    });
    expect(invitation.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    const activationToken = 'staff-invitation-token-that-is-long-enough-123';
    await prisma.staffInvitation.update({
      where: { id: invitation.id },
      data: { tokenHash: createHash('sha256').update(activationToken).digest('hex') },
    });

    await request(app.getHttpServer())
      .post('/api/v1/auth/staff-invitations/accept')
      .send({ token: activationToken, password: 'StaffPassword1!' })
      .expect(204);
    await request(app.getHttpServer())
      .post('/api/v1/auth/staff-invitations/accept')
      .send({ token: activationToken, password: 'StaffPassword1!' })
      .expect(400);
    const invitedLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'invited.operator@example.com', password: 'StaffPassword1!' })
      .expect(200);
    const invitedAccessToken = invitedLogin.body.accessToken as string;

    const invitedUser = await prisma.user.findUniqueOrThrow({
      where: { email: 'invited.operator@example.com' },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/users/${invitedUser.id}/role`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ role: Role.ADMIN })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/users/${invitedUser.id}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: Role.ADMIN })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/users/${invitedUser.id}/role`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ role: Role.ADMIN })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/users/${invitedUser.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: UserStatus.SUSPENDED })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/users/${invitedUser.id}/role`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ role: Role.SUPER_ADMIN })
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/admin/audit-logs')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/admin/audit-logs')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/users/${invitedUser.id}/role`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ role: Role.STAFF })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/users/${invitedUser.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: UserStatus.SUSPENDED })
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${invitedAccessToken}`)
      .expect(401);
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/users/${invitedUser.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: UserStatus.ACTIVE })
      .expect(200);

    expect(
      await prisma.auditLog.count({
        where: {
          entityId: invitedUser.id,
          action: {
            in: ['STAFF_INVITATION_ACCEPTED', 'SYSTEM_USER_SUSPENDED', 'SYSTEM_USER_REACTIVATED'],
          },
        },
      }),
    ).toBe(3);
  });

  it('resends a one-time invitation and lets the customer create their own password', async () => {
    const previous = await prisma.accountInvitation.findFirstOrThrow({
      where: { userId: invitedUserId, status: AccountInvitationStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    });
    await waitUntil(async () => {
      const invitation = await prisma.accountInvitation.findUnique({
        where: { id: previous.id },
        select: { sentAt: true },
      });
      return Boolean(invitation?.sentAt);
    });
    await request(app.getHttpServer())
      .post(`/api/v1/customers/${invitedCustomerId}/invitation/resend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(
      await prisma.accountInvitation.findUniqueOrThrow({ where: { id: previous.id } }),
    ).toEqual(expect.objectContaining({ status: AccountInvitationStatus.REVOKED }));

    await prisma.accountInvitation.updateMany({
      where: { userId: invitedUserId, status: AccountInvitationStatus.PENDING },
      data: { status: AccountInvitationStatus.REVOKED },
    });
    const activationToken = 'e2e-secure-activation-token-that-is-long-enough';
    await prisma.accountInvitation.create({
      data: {
        userId: invitedUserId,
        tokenHash: createHash('sha256').update(activationToken).digest('hex'),
        reason: AccountInvitationReason.RESEND,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await request(app.getHttpServer())
      .post('/api/v1/auth/activation/verify')
      .send({ token: activationToken })
      .expect(200)
      .expect({ valid: true });
    await request(app.getHttpServer())
      .post('/api/v1/auth/activation')
      .send({ token: activationToken, password: 'CustomerPassword1!' })
      .expect(204);
    await request(app.getHttpServer())
      .post('/api/v1/auth/activation')
      .send({ token: activationToken, password: 'CustomerPassword1!' })
      .expect(400);

    const activated = await prisma.customer.findUniqueOrThrow({
      where: { id: invitedCustomerId },
      include: { user: true },
    });
    expect(activated.status).toBe('ACTIVE');
    expect(activated.user).toEqual(
      expect.objectContaining({ status: UserStatus.ACTIVE, isActive: true }),
    );
    expect(activated.user?.passwordHash).not.toBe('CustomerPassword1!');
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: customerInput.email, password: 'CustomerPassword1!' })
      .expect(200);
  });

  it('blocks staff assignment and creates deterministic invoices for active subscriptions', async () => {
    const plan = await request(app.getHttpServer())
      .post('/api/v1/plans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'E2E Essential 50',
        description: 'End-to-end test plan',
        downloadMbps: 50,
        uploadMbps: 20,
        monthlyCents: 6900,
      })
      .expect(201);
    planId = plan.body.id;

    await request(app.getHttpServer())
      .post('/api/v1/payments/public-plan-checkout-session')
      .send({
        planId,
        firstName: 'Duplicate',
        lastName: 'Customer',
        email: 'customer@merotelecom.test',
        phone: '+61400000001',
        residentialSameAsService: true,
        billingSameAsResidential: true,
        termsAccepted: true,
        privacyAccepted: true,
      })
      .expect(409);
    expect(await prisma.user.count({ where: { email: 'customer@merotelecom.test' } })).toBe(1);

    await request(app.getHttpServer())
      .post('/api/v1/subscriptions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ customerId: customerAId, planId, startDate: '2026-09-01' })
      .expect(404);

    const subscriptionA = await createActiveSubscription(customerAId);
    const subscriptionB = await createActiveSubscription(customerBId);
    subscriptionAId = subscriptionA.id;
    subscriptionBId = subscriptionB.id;
    expect(subscriptionA.status).toBe(SubscriptionStatus.ACTIVE);

    const invoiceA = await generateInvoice(subscriptionA.id, '2026-09-01');
    const invoiceB = await generateInvoice(subscriptionB.id, '2026-09-01');
    invoiceAId = invoiceA.id;
    invoiceBId = invoiceB.id;
    expect(invoiceA).toEqual(
      expect.objectContaining({
        subtotalCents: 6273,
        taxCents: 627,
        totalCents: 6900,
        status: InvoiceStatus.ISSUED,
      }),
    );

    await request(app.getHttpServer())
      .post('/api/v1/invoices/generate')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ subscriptionId: subscriptionA.id, issueDate: '2026-09-01' })
      .expect(409);

    await request(app.getHttpServer())
      .get(`/api/v1/invoices/${invoiceAId}/pdf`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect('Content-Type', /application\/pdf/)
      .expect('Content-Disposition', /INV-2026-/)
      .expect(200);
  });

  it('runs owned scheduled and immediate cancellation without deleting billing history', async () => {
    const cancellationEmail = 'cancellation.customer@merotelecom.test';
    const cancellationUser = await prisma.user.create({
      data: {
        email: cancellationEmail,
        passwordHash: await hash(password, 12),
        roles: { create: { role: Role.CUSTOMER } },
      },
    });
    const cancellationCustomer = await prisma.customer.create({
      data: {
        userId: cancellationUser.id,
        customerNumber: 'CUST-E2E-CANCEL',
        firstName: 'Casey',
        lastName: 'Cancellation',
        email: cancellationEmail,
        phone: '+61400000033',
        addressLine1: '33 Test Street',
        suburb: 'Adelaide',
        state: 'SA',
        postcode: '5000',
      },
    });
    const subscription = await createActiveSubscription(cancellationCustomer.id);
    const invoice = await generateInvoice(subscription.id, '2026-09-02');
    const token = await loginDirectAs(cancellationEmail);
    const scheduledInput = {
      type: CancellationType.END_OF_PERIOD,
      reason: CancellationReason.NO_LONGER_REQUIRED,
      confirmed: true,
    };

    const emptyStatus = await request(app.getHttpServer())
      .get(`/api/v1/subscriptions/${subscription.id}/cancellation`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(emptyStatus.body).toEqual({ cancellation: null });

    await request(app.getHttpServer())
      .post(`/api/v1/subscriptions/${subscriptionAId}/cancellation`)
      .set('Authorization', `Bearer ${token}`)
      .send(scheduledInput)
      .expect(403);

    const scheduled = await request(app.getHttpServer())
      .post(`/api/v1/subscriptions/${subscription.id}/cancellation`)
      .set('Authorization', `Bearer ${token}`)
      .send(scheduledInput)
      .expect(201);
    expect(scheduled.body).toEqual(
      expect.objectContaining({
        requestNumber: expect.stringMatching(/^CAN-\d{4}-\d{5}$/),
        status: CancellationStatus.SCHEDULED,
        canRevoke: true,
      }),
    );
    expect(
      await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } }),
    ).toEqual(expect.objectContaining({ status: SubscriptionStatus.CANCELLATION_PENDING }));

    const repeated = await request(app.getHttpServer())
      .post(`/api/v1/subscriptions/${subscription.id}/cancellation`)
      .set('Authorization', `Bearer ${token}`)
      .send(scheduledInput)
      .expect(201);
    expect(repeated.body).toEqual(
      expect.objectContaining({ id: scheduled.body.id, reused: true }),
    );
    expect(
      await prisma.cancellationRequest.count({ where: { subscriptionId: subscription.id } }),
    ).toBe(1);

    await request(app.getHttpServer())
      .post(`/api/v1/subscriptions/${subscription.id}/plan-change/preview`)
      .set('Authorization', `Bearer ${token}`)
      .send({ targetPlanId: planId })
      .expect(409);

    const revoked = await request(app.getHttpServer())
      .post(`/api/v1/subscriptions/${subscription.id}/cancellation/revoke`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(revoked.body.status).toBe(CancellationStatus.REVOKED);
    expect(
      await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } }),
    ).toEqual(expect.objectContaining({ status: SubscriptionStatus.ACTIVE }));

    const immediate = await request(app.getHttpServer())
      .post(`/api/v1/subscriptions/${subscription.id}/cancellation`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: CancellationType.IMMEDIATE,
        reason: CancellationReason.SWITCHING_PROVIDER,
        confirmed: true,
      })
      .expect(201);
    expect(immediate.body.status).toBe(CancellationStatus.DISCONNECTION_PENDING);

    await request(app.getHttpServer())
      .post(`/api/v1/subscriptions/${subscription.id}/cancellation/revoke`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);

    const reconciled = await app.get(CancellationsService).reconcileDue(new Date(), 10);
    expect(reconciled.processed).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } }),
    ).toEqual(expect.objectContaining({ status: SubscriptionStatus.CANCELLED }));
    expect(await prisma.invoice.findUnique({ where: { id: invoice.id } })).not.toBeNull();
    expect(
      await prisma.cancellationRequest.findUniqueOrThrow({ where: { id: immediate.body.id } }),
    ).toEqual(expect.objectContaining({ status: CancellationStatus.COMPLETED }));
  });

  it('protects customer ownership and permits approved self-service updates', async () => {
    const adminDashboard = await request(app.getHttpServer())
      .get('/api/v1/dashboard/admin')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(adminDashboard.body).toEqual(
      expect.objectContaining({
        metrics: expect.objectContaining({ customerCount: expect.any(Number) }),
        attention: expect.any(Array),
        recentActivity: expect.any(Array),
        recentInvoices: expect.any(Array),
      }),
    );

    const superAdminDashboard = await request(app.getHttpServer())
      .get('/api/v1/dashboard/super-admin')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(200);
    expect(superAdminDashboard.body).toEqual(
      expect.objectContaining({
        business: expect.objectContaining({
          customerCount: expect.any(Number),
          failedPaymentCount: expect.any(Number),
        }),
        organisation: expect.objectContaining({
          activeAdmins: expect.any(Number),
          activeStaff: expect.any(Number),
          restrictedInternalAccounts: expect.any(Number),
        }),
        governance: expect.any(Object),
        attention: expect.any(Array),
        recentPrivilegedActivity: expect.any(Array),
        recentBusinessActivity: expect.any(Array),
        systemHealth: expect.any(Array),
      }),
    );
    expect(JSON.stringify(superAdminDashboard.body)).not.toContain('passwordHash');
    expect(JSON.stringify(superAdminDashboard.body)).not.toContain('tokenHash');
    await request(app.getHttpServer())
      .get('/api/v1/dashboard/super-admin')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/dashboard/super-admin')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(403);

    customerToken = await loginAs('customer@merotelecom.test');
    await request(app.getHttpServer())
      .get('/api/v1/dashboard/super-admin')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/invoices/me/${invoiceAId}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/invoices/me/${invoiceBId}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerBId}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/dashboard/admin')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/dashboard/admin')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(403);

    const update = await request(app.getHttpServer())
      .patch('/api/v1/customers/me')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ phone: '+61400000004', suburb: 'Barangaroo' })
      .expect(200);
    expect(update.body.phone).toBe('+61400000004');
    await request(app.getHttpServer())
      .patch('/api/v1/customers/me')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ status: 'SUSPENDED' })
      .expect(400);
  });

  it('supports one customer and staff identity and reloads role changes from the database', async () => {
    const account = await prisma.user.findUniqueOrThrow({
      where: { email: 'customer@merotelecom.test' },
    });
    await prisma.userRole.create({
      data: { userId: account.id, role: Role.STAFF },
    });

    await request(app.getHttpServer())
      .get('/api/v1/dashboard/customer')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/customers?limit=10')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);

    await prisma.userRole.delete({
      where: { userId_role: { userId: account.id, role: Role.STAFF } },
    });
    await request(app.getHttpServer())
      .get('/api/v1/customers?limit=10')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);
  });

  it('runs controlled partial and full refunds with ownership, RBAC, idempotency, and webhook reconciliation', async () => {
    await prisma.invoice.update({
      where: { id: invoiceAId },
      data: { status: InvoiceStatus.PAID, paidAt: new Date() },
    });
    const payment = await prisma.payment.create({
      data: {
        invoiceId: invoiceAId,
        customerId: customerAId,
        provider: 'STRIPE',
        providerPaymentId: 'pi_e2e_refundable',
        amountCents: 6_900,
        currency: 'AUD',
        status: PaymentStatus.SUCCEEDED,
        paidAt: new Date(),
      },
    });
    customerBToken = await loginAs('customer-b@merotelecom.test');

    const customerBUser = await prisma.user.findUniqueOrThrow({
      where: { email: 'customer-b@merotelecom.test' },
      include: { roles: true },
    });
    await expect(
      app.get(RefundsService).request(
        payment.id,
        { reason: RefundReason.BILLING_ERROR },
        {
          id: customerBUser.id,
          email: customerBUser.email,
          role: Role.CUSTOMER,
          roles: customerBUser.roles.map(({ role }) => role),
        },
      ),
    ).rejects.toThrow('Payment not found.');

    await request(app.getHttpServer())
      .post(`/api/v1/payments/${payment.id}/refund-requests`)
      .set('Authorization', `Bearer ${customerBToken}`)
      .send({ reason: RefundReason.BILLING_ERROR })
      .expect(404);

    const requested = await request(app.getHttpServer())
      .post(`/api/v1/payments/${payment.id}/refund-requests`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ reason: RefundReason.SERVICE_ISSUE, details: 'Service was unavailable.' })
      .expect(201);
    const refundId = requested.body.id as string;
    expect(requested.body).not.toHaveProperty('internalNote');
    expect(requested.body).not.toHaveProperty('stripePaymentIntentId');

    await request(app.getHttpServer())
      .post(`/api/v1/payments/${payment.id}/refund-requests`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ reason: RefundReason.SERVICE_ISSUE })
      .expect(409);
    await request(app.getHttpServer())
      .get(`/api/v1/me/refunds/${refundId}`)
      .set('Authorization', `Bearer ${customerBToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .get('/api/v1/admin/refunds')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/refunds/${refundId}/review`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ internalNote: 'Verified the outage report.' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/refunds/${refundId}/process`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/v1/admin/refunds/${refundId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'PARTIAL',
        amountCents: 2_000,
        reason: RefundReason.SERVICE_ISSUE,
        internalNote: 'Approved two days of service impact.',
      })
      .expect(201);
    const processing = await request(app.getHttpServer())
      .post(`/api/v1/admin/refunds/${refundId}/process`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    const firstStripeRefundId = processing.body.stripeRefundId as string;
    expect(firstStripeRefundId).toMatch(/^re_e2e_/);
    expect(fakeStripeClient.client.refunds.create.mock.calls.at(-1)?.[1]).toEqual({
      idempotencyKey: `mero-refund-${refundId}-1`,
    });
    await request(app.getHttpServer())
      .post(`/api/v1/admin/refunds/${refundId}/process`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);

    const firstStripeRefund = stripeRefunds.get(firstStripeRefundId);
    if (!firstStripeRefund) throw new Error('Expected first fake Stripe refund.');
    firstStripeRefund.status = 'succeeded';
    const succeededEvent = refundStripeEvent(
      'evt_e2e_refund_partial',
      'refund.created',
      firstStripeRefund,
    );
    await postStripeEvent(succeededEvent).expect(200);
    await postStripeEvent(succeededEvent).expect(200);
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).toEqual(
      expect.objectContaining({
        status: PaymentStatus.PARTIALLY_REFUNDED,
        refundedCents: 2_000,
      }),
    );

    await request(app.getHttpServer())
      .post('/api/v1/admin/refunds')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ paymentId: payment.id, reason: RefundReason.BILLING_ERROR })
      .expect(403);
    const secondRequested = await request(app.getHttpServer())
      .post('/api/v1/admin/refunds')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        paymentId: payment.id,
        reason: RefundReason.BILLING_ERROR,
        internalNote: 'Correct the remaining charge.',
      })
      .expect(201);
    const secondRefundId = secondRequested.body.id as string;
    await request(app.getHttpServer())
      .post(`/api/v1/admin/refunds/${secondRefundId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'PARTIAL', amountCents: 5_000 })
      .expect(409);
    const approvedRemaining = await request(app.getHttpServer())
      .post(`/api/v1/admin/refunds/${secondRefundId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'FULL' })
      .expect(201);
    expect(approvedRemaining.body.refundAmountCents).toBe(4_900);
    const secondProcessing = await request(app.getHttpServer())
      .post(`/api/v1/admin/refunds/${secondRefundId}/process`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(201);
    const secondStripeRefund = stripeRefunds.get(secondProcessing.body.stripeRefundId as string);
    if (!secondStripeRefund) throw new Error('Expected second fake Stripe refund.');
    secondStripeRefund.status = 'succeeded';
    await postStripeEvent(
      refundStripeEvent('evt_e2e_refund_full', 'refund.updated', secondStripeRefund),
    ).expect(200);

    expect(await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).toEqual(
      expect.objectContaining({ status: PaymentStatus.REFUNDED, refundedCents: 6_900 }),
    );
    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceAId } })).toEqual(
      expect.objectContaining({ totalCents: 6_900, status: InvoiceStatus.PAID }),
    );
    expect(
      await prisma.auditLog.count({
        where: {
          entityType: 'Refund',
          entityId: { in: [refundId, secondRefundId] },
          action: { in: ['REFUND_REQUESTED', 'REFUND_APPROVED', 'REFUND_SUCCEEDED'] },
        },
      }),
    ).toBe(6);
  });

  it('previews and applies a paid upgrade exactly once through the verified webhook', async () => {
    await prisma.invoice.update({
      where: { id: invoiceAId },
      data: { status: InvoiceStatus.PAID, paidAt: new Date() },
    });
    upgradedPlanId = await createPlan('E2E Family 100', 100, 40, 9900);
    cheaperPlanId = await createPlan('E2E Starter 25', 25, 10, 4900);

    await request(app.getHttpServer())
      .post(`/api/v1/subscriptions/${subscriptionBId}/plan-change/preview`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ targetPlanId: upgradedPlanId })
      .expect(404);

    const preview = await request(app.getHttpServer())
      .post(`/api/v1/subscriptions/${subscriptionAId}/plan-change/preview`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ targetPlanId: upgradedPlanId })
      .expect(201);
    expect(preview.body).toEqual(
      expect.objectContaining({
        type: PlanChangeType.UPGRADE,
        currentPlanPriceCents: 6900,
        targetPlanPriceCents: 9900,
        amountPayableCents: expect.any(Number),
        currency: 'AUD',
      }),
    );
    expect(preview.body.amountPayableCents).toBeGreaterThan(0);

    const created = await request(app.getHttpServer())
      .post(`/api/v1/subscriptions/${subscriptionAId}/plan-change`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ targetPlanId: upgradedPlanId })
      .expect(201);
    const requestId = created.body.planChange.id as string;
    const sessionId = (
      await prisma.planChangeRequest.findUniqueOrThrow({
        where: { id: requestId },
      })
    ).stripeCheckoutSessionId as string;
    expect(created.body.checkoutUrl).toBe(`https://checkout.stripe.test/${sessionId}`);

    const retried = await request(app.getHttpServer())
      .post(`/api/v1/subscriptions/${subscriptionAId}/plan-change`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ targetPlanId: upgradedPlanId })
      .expect(201);
    expect(retried.body.planChange.id).toBe(requestId);
    expect(
      await prisma.planChangeRequest.count({ where: { sourceSubscriptionId: subscriptionAId } }),
    ).toBe(1);
    await request(app.getHttpServer())
      .post(`/api/v1/subscriptions/${subscriptionAId}/plan-change`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ targetPlanId: cheaperPlanId })
      .expect(409);

    const session = stripeSessions.get(sessionId);
    if (!session) throw new Error('Expected the fake plan-change Checkout session.');
    const paidSession = {
      ...session,
      payment_status: 'paid',
      payment_intent: 'pi_e2e_plan_change_paid',
    } as Stripe.Checkout.Session;

    await postStripeEvent(
      stripeEvent('evt_e2e_invalid_signature', 'checkout.session.completed', paidSession),
      'invalid-signature',
    ).expect(400);
    await postStripeEvent(
      stripeEvent('evt_e2e_wrong_checkout_kind', 'checkout.session.completed', {
        ...paidSession,
        metadata: { ...paidSession.metadata, checkoutKind: 'plan_purchase' },
      } as Stripe.Checkout.Session),
    ).expect(404);
    await postStripeEvent(
      stripeEvent('evt_e2e_missing_metadata', 'checkout.session.completed', {
        ...paidSession,
        metadata: { ...paidSession.metadata, planChangeRequestId: undefined },
      } as Stripe.Checkout.Session),
    ).expect(400);
    await postStripeEvent(
      stripeEvent('evt_e2e_amount_mismatch', 'checkout.session.completed', {
        ...paidSession,
        amount_total: (paidSession.amount_total ?? 0) + 1,
      } as Stripe.Checkout.Session),
    ).expect(400);
    await postStripeEvent(
      stripeEvent('evt_e2e_currency_mismatch', 'checkout.session.completed', {
        ...paidSession,
        currency: 'usd',
      } as Stripe.Checkout.Session),
    ).expect(400);
    expect(await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionAId } })).toEqual(
      expect.objectContaining({ status: SubscriptionStatus.ACTIVE }),
    );

    const completed = stripeEvent(
      'evt_e2e_plan_change_paid',
      'checkout.session.completed',
      paidSession,
    );
    const completedResponse = await postStripeEvent(completed);
    if (completedResponse.status !== 200) {
      throw new Error(`Paid plan-change webhook failed: ${JSON.stringify(completedResponse.body)}`);
    }
    expect(completedResponse.body).toEqual({ received: true });
    await postStripeEvent(completed).expect(200, { received: true });
    await postStripeEvent(
      stripeEvent('evt_e2e_expired_after_paid', 'checkout.session.expired', {
        ...paidSession,
        payment_status: 'unpaid',
        status: 'expired',
      } as Stripe.Checkout.Session),
    ).expect(200, { received: true });

    const applied = await prisma.planChangeRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(applied).toEqual(
      expect.objectContaining({ status: PlanChangeStatus.APPLIED, appliedAt: expect.any(Date) }),
    );
    expect(applied.newSubscriptionId).toEqual(expect.any(String));
    upgradedSubscriptionId = applied.newSubscriptionId as string;
    const [oldSubscription, newSubscription] = await Promise.all([
      prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionAId } }),
      prisma.subscription.findUniqueOrThrow({ where: { id: applied.newSubscriptionId as string } }),
    ]);
    expect(oldSubscription).toEqual(
      expect.objectContaining({
        status: SubscriptionStatus.CANCELLED,
        endReason: 'PLAN_UPGRADE',
      }),
    );
    expect(newSubscription).toEqual(
      expect.objectContaining({
        status: SubscriptionStatus.ACTIVE,
        planId: upgradedPlanId,
        currentPeriodEnd: oldSubscription.currentPeriodEnd,
      }),
    );
    expect(
      await prisma.subscription.count({
        where: { customerId: customerAId, status: SubscriptionStatus.ACTIVE },
      }),
    ).toBe(1);
    expect(
      await prisma.payment.count({
        where: { planChangeRequest: { id: requestId }, status: PaymentStatus.SUCCEEDED },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { action: 'PLAN_CHANGE_APPLIED', entityId: applied.newSubscriptionId as string },
      }),
    ).toBe(1);
    expect(
      await prisma.paymentWebhookEvent.count({ where: { planChangeRequestId: requestId } }),
    ).toBe(2);

    const status = await request(app.getHttpServer())
      .get(`/api/v1/plan-change-requests/me/${requestId}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(status.body.status).toBe(PlanChangeStatus.APPLIED);
    expect(status.body.stripeCheckoutSessionId).toBeUndefined();
    const adminHistory = await request(app.getHttpServer())
      .get(
        `/api/v1/plan-change-requests?status=${PlanChangeStatus.APPLIED}&type=${PlanChangeType.UPGRADE}`,
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(adminHistory.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: requestId,
          auditHistory: expect.arrayContaining([
            expect.objectContaining({ action: 'PLAN_UPGRADE_PAYMENT_COMPLETED' }),
          ]),
        }),
      ]),
    );
  });

  it('reconciles an owned paid upgrade when the signed webhook was missed', async () => {
    await prisma.invoice.update({
      where: { id: invoiceBId },
      data: { status: InvoiceStatus.PAID, paidAt: new Date() },
    });
    const targetPlanId = await createPlan('E2E Reconciled 150', 150, 50, 11900);
    const created = await request(app.getHttpServer())
      .post(`/api/v1/subscriptions/${subscriptionBId}/plan-change`)
      .set('Authorization', `Bearer ${customerBToken}`)
      .send({ targetPlanId })
      .expect(201);
    const requestId = created.body.planChange.id as string;
    const stored = await prisma.planChangeRequest.findUniqueOrThrow({ where: { id: requestId } });
    const sessionId = stored.stripeCheckoutSessionId as string;
    const session = stripeSessions.get(sessionId);
    if (!session) throw new Error('Expected the fake reconciliation Checkout session.');
    const paidSession = {
      ...session,
      status: 'complete',
      payment_status: 'paid',
      payment_intent: 'pi_e2e_reconciled_upgrade',
      url: null,
    } as Stripe.Checkout.Session;
    stripeSessions.set(sessionId, paidSession);

    await request(app.getHttpServer())
      .post(`/api/v1/plan-change-requests/${requestId}/reconcile`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(404);
    const reconciled = await request(app.getHttpServer())
      .post(`/api/v1/plan-change-requests/${requestId}/reconcile`)
      .set('Authorization', `Bearer ${customerBToken}`)
      .expect(201);
    expect(reconciled.body).toEqual(
      expect.objectContaining({
        status: PlanChangeStatus.APPLIED,
        newSubscriptionId: expect.any(String),
      }),
    );
    await request(app.getHttpServer())
      .post(`/api/v1/plan-change-requests/${requestId}/reconcile`)
      .set('Authorization', `Bearer ${customerBToken}`)
      .expect(201);

    await postStripeEvent(
      stripeEvent(
        'evt_e2e_reconciled_upgrade_late_webhook',
        'checkout.session.completed',
        paidSession,
      ),
    ).expect(200, { received: true });
    expect(
      await prisma.subscription.count({
        where: { customerId: customerBId, status: SubscriptionStatus.ACTIVE },
      }),
    ).toBe(1);
    expect(
      await prisma.paymentWebhookEvent.findMany({
        where: { planChangeRequestId: requestId },
        select: { providerEventId: true },
        orderBy: { processedAt: 'asc' },
      }),
    ).toEqual([
      { providerEventId: `reconcile:${sessionId}:paid` },
      { providerEventId: 'evt_e2e_reconciled_upgrade_late_webhook' },
    ]);
  });

  it('reconciles an owned paid plan purchase and activates one subscription', async () => {
    const user = await prisma.user.create({
      data: {
        email: 'checkout-reconcile@merotelecom.test',
        passwordHash: await hash(password, 12),
        roles: { create: { role: Role.CUSTOMER } },
      },
    });
    const customer = await prisma.customer.create({
      data: {
        userId: user.id,
        customerNumber: 'CUST-E2E-RECONCILE',
        firstName: 'Riley',
        lastName: 'Chen',
        email: user.email,
        phone: '+61400000009',
        addressLine1: '9 George Street',
        suburb: 'Sydney',
        state: 'NSW',
        postcode: '2000',
      },
    });
    const token = await loginAs(user.email);
    const created = await request(app.getHttpServer())
      .post('/api/v1/payments/plan-checkout-session')
      .set('Authorization', `Bearer ${token}`)
      .send({ planId })
      .expect(201);
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: created.body.paymentId as string },
    });
    const sessionId = payment.providerSessionId as string;
    const session = stripeSessions.get(sessionId);
    if (!session) throw new Error('Expected the fake plan-purchase Checkout session.');
    const paidSession = {
      ...session,
      status: 'complete',
      payment_status: 'paid',
      payment_intent: 'pi_e2e_reconciled_plan_purchase',
      url: null,
    } as Stripe.Checkout.Session;
    stripeSessions.set(sessionId, paidSession);

    await request(app.getHttpServer())
      .get(`/api/v1/payments/checkout-status?sessionId=${sessionId}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(404);
    const reconciled = await request(app.getHttpServer())
      .get(`/api/v1/payments/checkout-status?sessionId=${sessionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(reconciled.body).toEqual(
      expect.objectContaining({
        paymentStatus: PaymentStatus.SUCCEEDED,
        invoiceStatus: InvoiceStatus.PAID,
        subscription: expect.objectContaining({ status: SubscriptionStatus.ACTIVE }),
      }),
    );
    await request(app.getHttpServer())
      .get(`/api/v1/payments/checkout-status?sessionId=${sessionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await postStripeEvent(
      stripeEvent(
        'evt_e2e_reconciled_plan_purchase_late_webhook',
        'checkout.session.completed',
        paidSession,
      ),
    ).expect(200, { received: true });

    expect(
      await prisma.subscription.count({
        where: { customerId: customer.id, status: SubscriptionStatus.ACTIVE },
      }),
    ).toBe(1);
    expect(
      await prisma.paymentWebhookEvent.findMany({
        where: { paymentId: payment.id },
        select: { providerEventId: true },
        orderBy: { processedAt: 'asc' },
      }),
    ).toEqual([
      { providerEventId: `reconcile:${sessionId}` },
      { providerEventId: 'evt_e2e_reconciled_plan_purchase_late_webhook' },
    ]);
  });

  it('keeps the current subscription unchanged for expired, failed, and invalidated upgrades', async () => {
    const firstHigherPlanId = await createPlan('E2E Premium 250', 250, 80, 12900);
    const expired = await startUpgrade(upgradedSubscriptionId, firstHigherPlanId);
    const expiredSession = {
      ...expired.session,
      status: 'expired',
      payment_status: 'unpaid',
    } as Stripe.Checkout.Session;
    const expiredEvent = stripeEvent(
      'evt_e2e_plan_change_expired',
      'checkout.session.expired',
      expiredSession,
    );
    await postStripeEvent(expiredEvent).expect(200, { received: true });
    await postStripeEvent(expiredEvent).expect(200, { received: true });
    await postStripeEvent(
      stripeEvent('evt_e2e_paid_after_expired', 'checkout.session.completed', {
        ...expired.session,
        payment_status: 'paid',
        payment_intent: 'pi_e2e_late_after_expiry',
      } as Stripe.Checkout.Session),
    ).expect(200, { received: true });
    expect(
      await prisma.planChangeRequest.findUniqueOrThrow({ where: { id: expired.requestId } }),
    ).toEqual(
      expect.objectContaining({
        status: PlanChangeStatus.EXPIRED,
        failureReason: 'CHECKOUT_EXPIRED',
      }),
    );
    expect(
      await prisma.paymentWebhookEvent.count({
        where: { planChangeRequestId: expired.requestId },
      }),
    ).toBe(2);

    const asynchronousFailure = await startUpgrade(upgradedSubscriptionId, firstHigherPlanId);
    await postStripeEvent(
      stripeEvent(
        'evt_e2e_async_plan_change_failed',
        'checkout.session.async_payment_failed',
        asynchronousFailure.session,
      ),
    ).expect(200, { received: true });
    expect(
      await prisma.planChangeRequest.findUniqueOrThrow({
        where: { id: asynchronousFailure.requestId },
      }),
    ).toEqual(
      expect.objectContaining({ status: PlanChangeStatus.FAILED, failureReason: 'PAYMENT_FAILED' }),
    );

    const suspendedTargetId = await createPlan('E2E Ultra 500', 500, 100, 14900);
    const suspended = await startUpgrade(upgradedSubscriptionId, suspendedTargetId);
    await prisma.subscription.update({
      where: { id: upgradedSubscriptionId },
      data: { status: SubscriptionStatus.SUSPENDED },
    });
    await postStripeEvent(
      stripeEvent('evt_e2e_paid_while_suspended', 'checkout.session.completed', {
        ...suspended.session,
        payment_status: 'paid',
        payment_intent: 'pi_e2e_suspended',
      } as Stripe.Checkout.Session),
    ).expect(200, { received: true });
    expect(
      await prisma.planChangeRequest.findUniqueOrThrow({ where: { id: suspended.requestId } }),
    ).toEqual(
      expect.objectContaining({
        status: PlanChangeStatus.FAILED,
        failureReason: 'SOURCE_NOT_ACTIVE',
      }),
    );
    expect(
      await prisma.subscription.findUniqueOrThrow({ where: { id: upgradedSubscriptionId } }),
    ).toEqual(
      expect.objectContaining({ status: SubscriptionStatus.SUSPENDED, planId: upgradedPlanId }),
    );
    await prisma.subscription.update({
      where: { id: upgradedSubscriptionId },
      data: { status: SubscriptionStatus.ACTIVE },
    });

    const overdueTargetId = await createPlan('E2E Gigabit 1000', 1000, 200, 16900);
    const overdue = await startUpgrade(upgradedSubscriptionId, overdueTargetId);
    await prisma.invoice.update({
      where: { id: invoiceAId },
      data: { status: InvoiceStatus.OVERDUE, paidAt: null },
    });
    await postStripeEvent(
      stripeEvent('evt_e2e_paid_with_overdue_invoice', 'checkout.session.completed', {
        ...overdue.session,
        payment_status: 'paid',
        payment_intent: 'pi_e2e_overdue',
      } as Stripe.Checkout.Session),
    ).expect(200, { received: true });
    expect(
      await prisma.planChangeRequest.findUniqueOrThrow({ where: { id: overdue.requestId } }),
    ).toEqual(
      expect.objectContaining({
        status: PlanChangeStatus.FAILED,
        failureReason: 'OUTSTANDING_INVOICE',
      }),
    );
    expect(
      await prisma.subscription.findUniqueOrThrow({ where: { id: upgradedSubscriptionId } }),
    ).toEqual(
      expect.objectContaining({ status: SubscriptionStatus.ACTIVE, planId: upgradedPlanId }),
    );
    expect(
      await prisma.subscription.count({
        where: { customerId: customerAId, status: SubscriptionStatus.ACTIVE },
      }),
    ).toBe(1);
    await prisma.invoice.update({
      where: { id: invoiceAId },
      data: { status: InvoiceStatus.PAID, paidAt: new Date() },
    });
  });

  it('schedules, cancels, and idempotently applies a downgrade at the billing boundary', async () => {
    const preview = await request(app.getHttpServer())
      .post(`/api/v1/subscriptions/${upgradedSubscriptionId}/plan-change/preview`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ targetPlanId: cheaperPlanId })
      .expect(201);
    expect(preview.body).toEqual(
      expect.objectContaining({
        type: PlanChangeType.DOWNGRADE,
        amountPayableCents: 0,
      }),
    );

    const scheduled = await request(app.getHttpServer())
      .post(`/api/v1/subscriptions/${upgradedSubscriptionId}/plan-change`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ targetPlanId: cheaperPlanId })
      .expect(201);
    expect(scheduled.body).toEqual({
      planChange: expect.objectContaining({ status: PlanChangeStatus.SCHEDULED }),
      checkoutUrl: null,
    });
    const firstRequestId = scheduled.body.planChange.id as string;
    await request(app.getHttpServer())
      .post(`/api/v1/plan-change-requests/${firstRequestId}/cancel`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(201)
      .expect((response) => expect(response.body.status).toBe(PlanChangeStatus.CANCELLED));

    const rescheduled = await request(app.getHttpServer())
      .post(`/api/v1/subscriptions/${upgradedSubscriptionId}/plan-change`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ targetPlanId: cheaperPlanId })
      .expect(201);
    const requestId = rescheduled.body.planChange.id as string;
    await request(app.getHttpServer())
      .post(`/api/v1/subscriptions/${upgradedSubscriptionId}/plan-change`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ targetPlanId: planId })
      .expect(409);

    const effectiveAt = new Date(Date.now() - 60_000);
    const periodStart = new Date(effectiveAt);
    periodStart.setUTCMonth(periodStart.getUTCMonth() - 1);
    await prisma.$transaction([
      prisma.subscription.update({
        where: { id: upgradedSubscriptionId },
        data: { currentPeriodStart: periodStart, currentPeriodEnd: effectiveAt },
      }),
      prisma.planChangeRequest.update({
        where: { id: requestId },
        data: {
          currentPeriodStartSnapshot: periodStart,
          currentPeriodEndSnapshot: effectiveAt,
          effectiveAt,
        },
      }),
    ]);

    const planChanges = app.get(PlanChangesService);
    await planChanges.reconcileDueDowngrades(new Date());
    await planChanges.reconcileDueDowngrades(new Date());

    const applied = await prisma.planChangeRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(applied).toEqual(
      expect.objectContaining({
        status: PlanChangeStatus.APPLIED,
        newSubscriptionId: expect.any(String),
      }),
    );
    const [oldSubscription, newSubscription] = await Promise.all([
      prisma.subscription.findUniqueOrThrow({ where: { id: upgradedSubscriptionId } }),
      prisma.subscription.findUniqueOrThrow({ where: { id: applied.newSubscriptionId as string } }),
    ]);
    expect(oldSubscription).toEqual(
      expect.objectContaining({
        status: SubscriptionStatus.CANCELLED,
        endReason: 'PLAN_DOWNGRADE',
      }),
    );
    expect(newSubscription).toEqual(
      expect.objectContaining({
        status: SubscriptionStatus.ACTIVE,
        planId: cheaperPlanId,
        currentPeriodStart: effectiveAt,
      }),
    );
    expect(newSubscription.currentPeriodEnd.getTime()).toBeGreaterThan(effectiveAt.getTime());
    expect(
      await prisma.subscription.count({
        where: { customerId: customerAId, status: SubscriptionStatus.ACTIVE },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { action: 'SCHEDULED_DOWNGRADE_APPLIED', entityId: requestId },
      }),
    ).toBe(1);

    const renewalInvoice = await generateInvoice(
      newSubscription.id,
      effectiveAt.toISOString().slice(0, 10),
    );
    expect(renewalInvoice).toEqual(
      expect.objectContaining({
        subscriptionId: newSubscription.id,
        totalCents: 4900,
        status: InvoiceStatus.ISSUED,
      }),
    );
  });

  it(
    'supports secure customer and staff support conversations through resolution',
    verifySupportWorkflow,
  );

  it('supports secure public prospect enquiries in the shared escalation workflow', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/support/public/enquiries')
      .send({
        name: 'J',
        email: 'not-an-email',
        category: 'BILLING',
        subject: 'x',
        message: 'short',
      })
      .expect(400);

    const enquiryInput = {
      name: 'Jamie Prospect',
      email: 'jamie.prospect@example.test',
      phone: '+61412345678',
      category: 'NBN_AVAILABILITY',
      subject: 'Availability at Seacombe Gardens',
      address: '1 Brigalow Avenue, Seacombe Gardens SA 5047',
      message: 'Can I order an NBN 100 plan at this address?',
      website: '',
    };
    const created = await request(app.getHttpServer())
      .post('/api/v1/support/public/enquiries')
      .set('Idempotency-Key', 'prospect-e2e-submission-0001')
      .send(enquiryInput)
      .expect(201);
    expect(created.body.referenceNumber).toMatch(/^MT-E-\d{4}-\d{5}$/);
    const caseNumber = created.body.referenceNumber as string;

    const duplicate = await request(app.getHttpServer())
      .post('/api/v1/support/public/enquiries')
      .set('Idempotency-Key', 'prospect-e2e-submission-0001')
      .send(enquiryInput)
      .expect(201);
    expect(duplicate.body.referenceNumber).toBe(caseNumber);

    const stored = await prisma.supportCase.findUniqueOrThrow({
      where: { caseNumber },
      include: { messages: true },
    });
    expect(stored).toEqual(
      expect.objectContaining({
        requestType: SupportRequestType.PROSPECT_ENQUIRY,
        customerId: null,
        prospectEmail: enquiryInput.email,
      }),
    );
    expect(stored.messages[0]).toEqual(
      expect.objectContaining({
        senderUserId: null,
        visibility: SupportMessageVisibility.CUSTOMER_VISIBLE,
      }),
    );

    await request(app.getHttpServer())
      .get(`/api/v1/support/public/enquiries/${caseNumber}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/customer/support/${caseNumber}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(404);

    const queue = await request(app.getHttpServer())
      .get('/api/v1/staff/support')
      .query({ requestType: 'PROSPECT_ENQUIRY', search: 'Jamie Prospect', page: 1, limit: 10 })
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);
    expect(queue.body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ caseNumber, customer: null })]),
    );

    await request(app.getHttpServer())
      .post(`/api/v1/staff/support/${caseNumber}/take`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/staff/support/${caseNumber}/internal-notes`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ body: 'Coverage qualification needs an internal review.' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/staff/support/${caseNumber}/messages`)
      .set('Authorization', `Bearer ${staffToken}`)
      .field('body', 'Thanks Jamie. We are checking the address and will update you by email.')
      .expect(201);

    const supportCase = await prisma.supportCase.findUniqueOrThrow({
      where: { caseNumber },
      select: { id: true },
    });
    const internalRequest = await request(app.getHttpServer())
      .post('/api/v1/staff/internal-requests')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        type: 'SUPPORT_ASSISTANCE',
        title: 'Review prospect address availability',
        description: 'The prospect address requires an Admin decision before we reply.',
        supportCaseId: supportCase.id,
      })
      .expect(201);
    const requestNumber = internalRequest.body.requestNumber as string;
    await request(app.getHttpServer())
      .post(`/api/v1/admin/internal-requests/${requestNumber}/take`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/internal-requests/${requestNumber}/start-review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/internal-requests/${requestNumber}/escalate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        reason: 'Serviceability exception requires Super Admin review.',
        priority: 'HIGH',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/staff/support/${caseNumber}/resolve`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ resolutionNote: 'A stale staff view must not resolve this enquiry.' })
      .expect(409)
      .expect(({ body }) => expect(body.message).toContain('Super Admin'));

    const customer = await prisma.customer.findUniqueOrThrow({
      where: { id: customerAId },
      select: { customerNumber: true },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/staff/support/${caseNumber}/link-customer`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ customerNumber: customer.customerNumber })
      .expect(201);
    const customerView = await request(app.getHttpServer())
      .get(`/api/v1/customer/support/${caseNumber}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(customerView.body.prospectEmail).toBeUndefined();
    expect(customerView.body.messages).toHaveLength(2);
    expect(JSON.stringify(customerView.body)).not.toContain('internal review');

    await request(app.getHttpServer())
      .post(`/api/v1/staff/support/${caseNumber}/link-customer`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ customerNumber: customer.customerNumber })
      .expect(201);

    let rateLimited = false;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/support/public/enquiries')
        .set('Idempotency-Key', `prospect-rate-limit-${attempt}`)
        .send({ ...enquiryInput, email: `rate-${attempt}@example.test` });
      if (response.status === 429) {
        rateLimited = true;
        break;
      }
    }
    expect(rateLimited).toBe(true);
  });

  it(
    'supports private Staff to Admin internal requests without executing linked actions',
    verifyInternalRequestWorkflow,
  );

  it('enforces coverage management RBAC and qualifies only trusted selected addresses', async () => {
    const ready = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
    expect(ready.body.checks).toEqual({ database: 'ok', redis: 'ok' });
    expect(ready.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

    await request(app.getHttpServer()).get('/api/v1/coverage-management/regions').expect(401);
    const region = await request(app.getHttpServer())
      .post('/api/v1/coverage-management/regions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        countryCode: 'AU',
        stateCode: 'SA',
        name: 'South Australia',
        status: OperatingRegionStatus.ACTIVE,
      })
      .expect(201);
    const regionId = region.body.id as string;

    await request(app.getHttpServer())
      .get('/api/v1/coverage-management/regions?search=South')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200)
      .expect(({ body }) => expect(body).toHaveLength(1));
    await request(app.getHttpServer())
      .patch(`/api/v1/coverage-management/regions/${regionId}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ status: OperatingRegionStatus.DISABLED })
      .expect(403);

    for (const postcode of [
      {
        postcode: '5000',
        status: PostcodeCoverageStatus.AVAILABLE,
        technology: AccessTechnology.FTTP,
        maximumSpeedMbps: 100,
      },
      { postcode: '5001', status: PostcodeCoverageStatus.PARTIAL },
      { postcode: '5114', status: PostcodeCoverageStatus.COMING_SOON },
    ]) {
      await request(app.getHttpServer())
        .post('/api/v1/coverage-management/postcodes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ operatingRegionId: regionId, ...postcode })
        .expect(201);
    }
    await request(app.getHttpServer())
      .post('/api/v1/coverage-management/plan-rules')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        planId,
        technology: AccessTechnology.FTTP,
        maximumSpeedMbps: 100,
        operatingRegionId: regionId,
      })
      .expect(201);
    const overrideSelection = await request(app.getHttpServer())
      .get('/api/v1/coverage/address-suggestions')
      .query({ query: 'override' })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/coverage-management/address-overrides/from-selection')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        operatingRegionId: regionId,
        selectionToken: overrideSelection.body.suggestions[0].selectionToken,
        status: AddressOverrideStatus.UNAVAILABLE,
        technology: null,
        maximumSpeedMbps: null,
        isActive: true,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/coverage-management/plan-rules')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ planId, technology: AccessTechnology.FTTP })
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/coverage-management/analytics')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .get('/api/v1/coverage/address-suggestions')
      .query({ query: 'ab' })
      .expect(400);
    const availableSuggestion = await request(app.getHttpServer())
      .get('/api/v1/coverage/address-suggestions')
      .query({ query: 'available' })
      .expect(200);
    expect(availableSuggestion.body.suggestions).toHaveLength(1);
    expect(availableSuggestion.body.suggestions[0]).toEqual(
      expect.objectContaining({
        selectionToken: expect.any(String),
        formattedAddress: coverageFixtures.available.formattedAddress,
      }),
    );
    expect(availableSuggestion.body.suggestions[0]).not.toHaveProperty('latitude');
    expect(availableSuggestion.body.suggestions[0]).not.toHaveProperty('providerAddressId');

    const covered = await request(app.getHttpServer())
      .post('/api/v1/coverage/check')
      .send({ selectionToken: availableSuggestion.body.suggestions[0].selectionToken })
      .expect(201);
    expect(covered.body).toEqual(
      expect.objectContaining({
        available: true,
        status: CoverageResultStatus.AVAILABLE,
        qualification: expect.objectContaining({ technology: AccessTechnology.FTTP }),
      }),
    );
    expect(covered.body.plans).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: planId })]),
    );
    expect(covered.body.qualificationToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const guestCheckout = request.agent(app.getHttpServer());
    const preparedCheckout = await guestCheckout
      .post('/api/v1/payments/public-checkout-context')
      .set('Origin', 'http://localhost:3000')
      .send({ planId, qualificationToken: covered.body.qualificationToken })
      .expect(201);
    expect(preparedCheckout.headers['set-cookie']?.[0]).toContain('mero_public_checkout_context=');
    await guestCheckout
      .get('/api/v1/payments/public-checkout-context')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.objectContaining({
            planId,
            serviceAddress: expect.objectContaining({
              formattedAddress: coverageFixtures.available.formattedAddress,
            }),
          }),
        );
        expect(body).not.toHaveProperty('trustedServiceAddress');
      });
    await guestCheckout
      .post('/api/v1/payments/public-plan-checkout-session')
      .set('Origin', 'http://localhost:3000')
      .send({
        planId,
        firstName: 'Coverage',
        lastName: 'Guest',
        email: 'coverage.guest@merotelecom.test',
        phone: '+61400000008',
        residentialSameAsService: true,
        billingSameAsResidential: true,
        termsAccepted: true,
        privacyAccepted: true,
      })
      .expect(201)
      .expect(({ body }) =>
        expect(body.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.test\//),
      );
    await guestCheckout.get('/api/v1/payments/public-checkout-context').expect(410);
    const checkoutApplication = await prisma.checkoutApplication.findFirstOrThrow({
      where: { applicantEmail: 'coverage.guest@merotelecom.test' },
    });
    expect(checkoutApplication.serviceAddress).toEqual(
      expect.objectContaining({
        addressLine1: '1 North Terrace',
        suburb: 'Adelaide',
        state: 'SA',
        postcode: '5000',
      }),
    );
    expect(checkoutApplication.residentialAddress).toEqual(checkoutApplication.serviceAddress);
    await request(app.getHttpServer())
      .post('/api/v1/coverage/check')
      .send({ selectionToken: availableSuggestion.body.suggestions[0].selectionToken })
      .expect(410);

    for (const [query, status] of [
      ['unsupported', CoverageResultStatus.NOT_AVAILABLE],
      ['victoria', CoverageResultStatus.OUTSIDE_OPERATING_REGION],
      ['coming', CoverageResultStatus.COMING_SOON],
      ['override', CoverageResultStatus.NOT_AVAILABLE],
    ] as const) {
      const suggestion = await request(app.getHttpServer())
        .get('/api/v1/coverage/address-suggestions')
        .query({ query })
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/v1/coverage/check')
        .send({ selectionToken: suggestion.body.suggestions[0].selectionToken })
        .expect(201)
        .expect(({ body }) => expect(body.status).toBe(status));
    }

    const analytics = await request(app.getHttpServer())
      .get('/api/v1/coverage-management/analytics?days=30')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(analytics.body.total).toBeGreaterThanOrEqual(5);
    expect(analytics.body.recent[0]).not.toHaveProperty('formattedAddress');

    let rateLimited = false;
    for (let attempt = 0; attempt < 21; attempt += 1) {
      const response = await request(app.getHttpServer())
        .get('/api/v1/coverage/address-suggestions')
        .query({ query: `no-result-${attempt}` });
      if (response.status === 429) {
        rateLimited = true;
        break;
      }
      expect(response.status).toBe(200);
    }
    expect(rateLimited).toBe(true);

    const auditCount = await prisma.auditLog.count({
      where: {
        actor: { roles: { some: { role: Role.ADMIN } } },
        action: {
          in: [
            'OPERATING_REGION_CREATED',
            'POSTCODE_COVERAGE_CREATED',
            'ADDRESS_COVERAGE_OVERRIDE_CREATED',
            'PLAN_COVERAGE_COMPATIBILITY_CREATED',
          ],
        },
      },
    });
    expect(auditCount).toBeGreaterThanOrEqual(6);
  });

  async function verifySupportWorkflow() {
    const otherCustomerToken = customerBToken;

    await request(app.getHttpServer())
      .post('/api/v1/customer/support')
      .field('category', 'BILLING')
      .field('subject', 'Duplicate charge')
      .field('message', 'I can see two charges on my statement.')
      .expect(401);

    const created = await request(app.getHttpServer())
      .post('/api/v1/customer/support')
      .set('Authorization', `Bearer ${customerToken}`)
      .field('category', 'BILLING')
      .field('subject', 'Duplicate charge')
      .field('message', 'I can see two charges on my statement.')
      .attach('files', Buffer.from('%PDF-1.7 support evidence'), {
        filename: 'statement.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    expect(created.body.caseNumber).toMatch(/^SUP-\d{4}-\d{5}$/);
    expect(created.body.customer).toBeUndefined();
    expect(created.body.messages[0].sender).toBeUndefined();
    expect(created.body.messages[0].attachments).toHaveLength(1);
    const caseNumber = created.body.caseNumber as string;
    const attachmentId = created.body.messages[0].attachments[0].id as string;

    const ownList = await request(app.getHttpServer())
      .get('/api/v1/customer/support')
      .query({ category: 'BILLING', search: caseNumber, page: 1, limit: 10 })
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(ownList.body.meta).toEqual(expect.objectContaining({ page: 1, total: 1 }));
    expect(ownList.body.data[0].caseNumber).toBe(caseNumber);

    await request(app.getHttpServer())
      .get(`/api/v1/customer/support/${caseNumber}`)
      .set('Authorization', `Bearer ${otherCustomerToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/customer/support/${caseNumber}/messages`)
      .set('Authorization', `Bearer ${otherCustomerToken}`)
      .field('body', 'Trying another customer case')
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/customer/support/${caseNumber}/attachments/${attachmentId}/access`)
      .set('Authorization', `Bearer ${otherCustomerToken}`)
      .expect(404);

    const queue = await request(app.getHttpServer())
      .get('/api/v1/staff/support')
      .query({ assignment: 'UNASSIGNED', status: 'OPEN', page: 1, limit: 10 })
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);
    expect(
      queue.body.data.some((item: { caseNumber: string }) => item.caseNumber === caseNumber),
    ).toBe(true);

    await request(app.getHttpServer())
      .post(`/api/v1/staff/support/${caseNumber}/take`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(201)
      .expect(({ body }) => expect(body.status).toBe('IN_PROGRESS'));
    await request(app.getHttpServer())
      .post(`/api/v1/staff/support/${caseNumber}/messages`)
      .set('Authorization', `Bearer ${staffToken}`)
      .field('body', 'Please confirm the transaction dates.')
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/staff/support/${caseNumber}/status`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ status: 'WAITING_FOR_CUSTOMER' })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/customer/support/${caseNumber}/messages`)
      .set('Authorization', `Bearer ${customerToken}`)
      .field('body', 'Both charges appeared on 7 September.')
      .expect(201)
      .expect(({ body }) => expect(body.supportCase.status).toBe('IN_PROGRESS'));

    await request(app.getHttpServer())
      .post(`/api/v1/staff/support/${caseNumber}/resolve`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ resolutionNote: 'The duplicate authorization has been released.' })
      .expect(201)
      .expect(({ body }) => expect(body.status).toBe('RESOLVED'));

    const resolved = await request(app.getHttpServer())
      .get(`/api/v1/customer/support/${caseNumber}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(resolved.body.resolvedAt).toBeTruthy();
    expect(resolved.body.messages).toHaveLength(4);

    await request(app.getHttpServer())
      .post(`/api/v1/customer/support/${caseNumber}/messages`)
      .set('Authorization', `Bearer ${customerToken}`)
      .field('body', 'The charge is still visible, please reopen this.')
      .expect(201)
      .expect(({ body }) => expect(body.supportCase.status).toBe('IN_PROGRESS'));

    await request(app.getHttpServer())
      .post(`/api/v1/customer/support/${caseNumber}/messages`)
      .set('Authorization', `Bearer ${customerToken}`)
      .field('body', '   ')
      .expect(400);

    const attachmentAccess = await request(app.getHttpServer())
      .get(`/api/v1/staff/support/${caseNumber}/attachments/${attachmentId}/access`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);
    expect(attachmentAccess.body.url).toContain(
      `/support/${caseNumber}/attachments/${attachmentId}/file`,
    );

    const auditActions = await prisma.auditLog.findMany({
      where: { entityType: 'SupportCase', metadata: { path: ['caseNumber'], equals: caseNumber } },
      select: { action: true },
    });
    expect(auditActions.map((event) => event.action)).toEqual(
      expect.arrayContaining([
        'SUPPORT_CASE_CREATED',
        'SUPPORT_CASE_ASSIGNED',
        'SUPPORT_STAFF_REPLIED',
        'SUPPORT_STATUS_CHANGED',
        'SUPPORT_CUSTOMER_REPLIED',
      ]),
    );
  }

  async function verifyInternalRequestWorkflow() {
    const supportCase = await request(app.getHttpServer())
      .post('/api/v1/customer/support')
      .set('Authorization', `Bearer ${customerToken}`)
      .field('category', 'BILLING')
      .field('subject', 'Payment needs internal review')
      .field('message', 'Please investigate the duplicate payment.')
      .expect(201);
    const supportCaseId = supportCase.body.id as string;
    const supportCaseNumber = supportCase.body.caseNumber as string;
    await request(app.getHttpServer())
      .post(`/api/v1/staff/support/${supportCaseNumber}/take`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/staff/internal-requests')
      .send({
        type: 'REFUND_REVIEW',
        title: 'Duplicate payment refund review',
        description: 'I verified two payments and need Admin authorisation.',
      })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/staff/internal-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        type: 'REFUND_REVIEW',
        title: 'Forbidden customer request',
        description: 'Customers must never reach this workflow.',
      })
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/admin/internal-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);

    const created = await request(app.getHttpServer())
      .post('/api/v1/staff/internal-requests')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        type: 'REFUND_REVIEW',
        title: 'Duplicate payment refund review',
        description: 'I verified two payments and need Admin authorisation.',
        priority: 'HIGH',
        customerId: customerAId,
        supportCaseId,
      })
      .expect(201);
    expect(created.body).toEqual(
      expect.objectContaining({
        requestNumber: expect.stringMatching(/^IR-\d{4}-\d{5}$/),
        status: InternalRequestStatus.PENDING,
        priority: 'HIGH',
        supportCase: expect.objectContaining({ caseNumber: supportCaseNumber }),
        customer: expect.objectContaining({ id: customerAId }),
      }),
    );
    expect(created.body.messages).toEqual([]);
    const requestNumber = created.body.requestNumber as string;

    await request(app.getHttpServer())
      .post('/api/v1/staff/internal-requests')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        type: 'BILLING_REVIEW',
        title: 'Duplicate active escalation',
        description: 'A second unfinished request must not be created for the same ticket.',
        customerId: customerAId,
        supportCaseId,
      })
      .expect(409);

    await request(app.getHttpServer())
      .post('/api/v1/staff/internal-requests')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        type: 'BILLING_REVIEW',
        title: 'Mismatched records',
        description: 'This should be rejected before persistence.',
        customerId: customerBId,
        supportCaseId,
      })
      .expect(400);

    await request(app.getHttpServer())
      .get('/api/v1/staff/internal-requests')
      .query({
        status: 'PENDING',
        type: 'REFUND_REVIEW',
        priority: 'HIGH',
        search: requestNumber,
        page: 1,
        limit: 10,
      })
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.meta).toEqual(expect.objectContaining({ page: 1, total: 1 }));
        expect(body.data[0].requestNumber).toBe(requestNumber);
      });
    await request(app.getHttpServer())
      .get(`/api/v1/staff/internal-requests/${requestNumber}`)
      .set('Authorization', `Bearer ${staffTwoToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/staff/internal-requests/${requestNumber}/messages`)
      .set('Authorization', `Bearer ${staffTwoToken}`)
      .send({ body: 'Attempting to access another Staff request.' })
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/internal-requests/${requestNumber}/approve`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ comment: 'Staff cannot approve.' })
      .expect(403);

    const context = await request(app.getHttpServer())
      .get('/api/v1/staff/internal-requests/context-options')
      .query({ supportCaseNumber })
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);
    expect(context.body).toEqual(
      expect.objectContaining({
        selectedCustomerId: customerAId,
        selectedSupportCaseId: supportCaseId,
      }),
    );

    await request(app.getHttpServer())
      .get('/api/v1/admin/internal-requests')
      .query({ status: 'PENDING', priority: 'HIGH', search: requestNumber, page: 1, limit: 10 })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.data[0].requestNumber).toBe(requestNumber));

    await request(app.getHttpServer())
      .post(`/api/v1/admin/internal-requests/${requestNumber}/take`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201)
      .expect(({ body }) => expect(body.assignedTo.email).toBe('admin@merotelecom.test'));
    await request(app.getHttpServer())
      .post(`/api/v1/admin/internal-requests/${requestNumber}/take`)
      .set('Authorization', `Bearer ${adminTwoToken}`)
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/internal-requests/${requestNumber}/messages`)
      .set('Authorization', `Bearer ${adminTwoToken}`)
      .send({ body: 'An unassigned Admin cannot reply.' })
      .expect(409);

    await request(app.getHttpServer())
      .post(`/api/v1/admin/internal-requests/${requestNumber}/messages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ body: 'I am beginning the review.' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/internal-requests/${requestNumber}/start-review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201)
      .expect(({ body }) => expect(body.status).toBe(InternalRequestStatus.IN_REVIEW));
    await request(app.getHttpServer())
      .post(`/api/v1/admin/internal-requests/${requestNumber}/request-info`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ comment: '   ' })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/internal-requests/${requestNumber}/request-info`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ comment: 'Confirm whether any credit has already been issued.' })
      .expect(201)
      .expect(({ body }) => expect(body.status).toBe(InternalRequestStatus.MORE_INFO_REQUIRED));
    await request(app.getHttpServer())
      .post(`/api/v1/staff/internal-requests/${requestNumber}/messages`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ body: 'No credit has been issued.' })
      .expect(201)
      .expect(({ body }) => expect(body.status).toBe(InternalRequestStatus.IN_REVIEW));
    await request(app.getHttpServer())
      .post(`/api/v1/admin/internal-requests/${requestNumber}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ comment: 'Approved for separate processing.' })
      .expect(201)
      .expect(({ body }) => {
        expect(body.status).toBe(InternalRequestStatus.APPROVED);
        expect(body.reviewedAt).toBeTruthy();
      });
    await request(app.getHttpServer())
      .post(`/api/v1/admin/internal-requests/${requestNumber}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(409);

    const beforeResolve = await prisma.refund.count({ where: { customerId: customerAId } });
    await request(app.getHttpServer())
      .post(`/api/v1/admin/internal-requests/${requestNumber}/resolve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/internal-requests/${requestNumber}/resolve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ comment: 'Underlying work was completed in the source module.' })
      .expect(201)
      .expect(({ body }) => expect(body.status).toBe(InternalRequestStatus.RESOLVED));
    expect(await prisma.refund.count({ where: { customerId: customerAId } })).toBe(beforeResolve);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/internal-requests/${requestNumber}/close`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(201)
      .expect(({ body }) => expect(body.status).toBe(InternalRequestStatus.CLOSED));
    await request(app.getHttpServer())
      .post(`/api/v1/staff/internal-requests/${requestNumber}/messages`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ body: 'Closed requests are read-only.' })
      .expect(409);

    const rejected = await request(app.getHttpServer())
      .post('/api/v1/staff/internal-requests')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        type: 'OTHER',
        title: 'Decision rejection path',
        description: 'Verify a required rejection reason.',
      })
      .expect(201);
    const rejectedNumber = rejected.body.requestNumber as string;
    await request(app.getHttpServer())
      .post(`/api/v1/admin/internal-requests/${rejectedNumber}/take`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/internal-requests/${rejectedNumber}/resolve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ comment: 'The underlying work is not complete.' })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/internal-requests/${rejectedNumber}/start-review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/internal-requests/${rejectedNumber}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ comment: 'The requested action is not supported by the evidence.' })
      .expect(201)
      .expect(({ body }) => expect(body.status).toBe(InternalRequestStatus.REJECTED));

    const escalated = await request(app.getHttpServer())
      .post('/api/v1/staff/internal-requests')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        type: 'REFUND_REVIEW',
        title: 'Exceptional refund authority review',
        description: 'The verified amount requires a Super Admin decision.',
        priority: 'HIGH',
        customerId: customerAId,
        supportCaseId,
      })
      .expect(201);
    const escalatedNumber = escalated.body.requestNumber as string;
    const escalatedId = escalated.body.id as string;
    await request(app.getHttpServer())
      .post(`/api/v1/admin/internal-requests/${escalatedNumber}/take`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/internal-requests/${escalatedNumber}/start-review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/internal-requests/${escalatedNumber}/escalate`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ reason: 'Staff must not escalate.', priority: 'HIGH' })
      .expect(403);
    const escalatedResponse = await request(app.getHttpServer())
      .post(`/api/v1/admin/internal-requests/${escalatedNumber}/escalate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        reason: 'The exceptional amount needs Super Admin authority.',
        priority: 'HIGH',
        comment: 'Payment evidence was verified; no action has been executed.',
      })
      .expect(201);
    expect(escalatedResponse.body).toEqual(
      expect.objectContaining({
        id: escalatedId,
        requestNumber: escalatedNumber,
        currentLevel: InternalRequestLevel.SUPER_ADMIN,
        status: InternalRequestStatus.PENDING,
      }),
    );
    await request(app.getHttpServer())
      .post(`/api/v1/admin/internal-requests/${escalatedNumber}/escalate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'A duplicate escalation must not be accepted.', priority: 'HIGH' })
      .expect(409);
    const staffTicketDuringEscalation = await request(app.getHttpServer())
      .get(`/api/v1/staff/support/${supportCaseNumber}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);
    expect(staffTicketDuringEscalation.body.capabilities).toEqual(
      expect.objectContaining({
        canResolve: false,
        canClose: false,
        resolutionBlockedReason: expect.stringContaining('Super Admin'),
      }),
    );
    await request(app.getHttpServer())
      .patch(`/api/v1/staff/support/${supportCaseNumber}/status`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ status: 'RESOLVED' })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/api/v1/staff/support/${supportCaseNumber}/status`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ status: 'CLOSED' })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/staff/support/${supportCaseNumber}/resolve`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ resolutionNote: 'A stale browser attempted to resolve this ticket.' })
      .expect(409)
      .expect(({ body }) => expect(body.message).toContain('Super Admin'));
    await request(app.getHttpServer())
      .post(`/api/v1/staff/support/${supportCaseNumber}/resolve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ resolutionNote: 'Admin must not bypass the pending decision.' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/super-admin/internal-requests/${escalatedNumber}/resolve`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ comment: 'Pending review cannot be bypassed.' })
      .expect(409);
    expect(
      await prisma.supportCase.findUniqueOrThrow({
        where: { caseNumber: supportCaseNumber },
        select: { status: true, resolvedAt: true },
      }),
    ).toEqual({ status: SupportStatus.IN_PROGRESS, resolvedAt: null });
    await request(app.getHttpServer())
      .post(`/api/v1/admin/internal-requests/${escalatedNumber}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/super-admin/internal-requests/${escalatedNumber}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/super-admin/internal-requests')
      .query({ currentLevel: 'SUPER_ADMIN', search: escalatedNumber, page: 1, limit: 10 })
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toHaveLength(1);
        expect(body.data[0].requestNumber).toBe(escalatedNumber);
      });
    await request(app.getHttpServer())
      .get(`/api/v1/super-admin/internal-requests/${escalatedNumber}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);

    const attachmentReply = await request(app.getHttpServer())
      .post(`/api/v1/staff/internal-requests/${escalatedNumber}/messages`)
      .set('Authorization', `Bearer ${staffToken}`)
      .field('body', 'Attached evidence for internal review only.')
      .attach('files', Buffer.from('%PDF-1.7 internal evidence'), {
        filename: 'internal-evidence.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    const internalAttachment = attachmentReply.body.messages.at(-1).attachments[0];
    await request(app.getHttpServer())
      .get(
        `/api/v1/staff/internal-requests/${escalatedNumber}/attachments/${internalAttachment.id}/access`,
      )
      .set('Authorization', `Bearer ${staffTwoToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(
        `/api/v1/super-admin/internal-requests/${escalatedNumber}/attachments/${internalAttachment.id}/access`,
      )
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/super-admin/internal-requests/${escalatedNumber}/take`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/super-admin/internal-requests/${escalatedNumber}/take`)
      .set('Authorization', `Bearer ${superAdminTwoToken}`)
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/super-admin/internal-requests/${escalatedNumber}/start-review`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/super-admin/internal-requests/${escalatedNumber}/request-info`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ comment: 'Confirm the payment has settled rather than remaining pending.' })
      .expect(201)
      .expect(({ body }) => expect(body.status).toBe(InternalRequestStatus.MORE_INFO_REQUIRED));
    await request(app.getHttpServer())
      .post(`/api/v1/staff/support/${supportCaseNumber}/resolve`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ resolutionNote: 'Information is still pending.' })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/internal-requests/${escalatedNumber}/messages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('body', 'Confirmed: the payment is settled.')
      .expect(201)
      .expect(({ body }) => expect(body.status).toBe(InternalRequestStatus.IN_REVIEW));
    await request(app.getHttpServer())
      .post(`/api/v1/super-admin/internal-requests/${escalatedNumber}/approve`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ comment: 'Approved. Continue through the standard refund workflow.' })
      .expect(201)
      .expect(({ body }) => expect(body.status).toBe(InternalRequestStatus.APPROVED));
    await request(app.getHttpServer())
      .post(`/api/v1/super-admin/internal-requests/${escalatedNumber}/resolve`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ comment: 'Approval is not operational completion.' })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/staff/support/${supportCaseNumber}/resolve`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ resolutionNote: 'Approval alone must not resolve the customer ticket.' })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/super-admin/internal-requests/${escalatedNumber}/reject`)
      .set('Authorization', `Bearer ${superAdminTwoToken}`)
      .send({ comment: 'Stale conflicting decision.' })
      .expect(409);
    const requestCountBeforeReturn = await prisma.internalRequest.count();
    await request(app.getHttpServer())
      .post(`/api/v1/super-admin/internal-requests/${escalatedNumber}/return-to-admin`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ comment: 'Please complete the authorised work in the existing refund module.' })
      .expect(201)
      .expect(({ body }) => {
        expect(body.currentLevel).toBe(InternalRequestLevel.ADMIN);
        expect(body.status).toBe(InternalRequestStatus.APPROVED);
      });
    expect(await prisma.internalRequest.count()).toBe(requestCountBeforeReturn);
    const beforeEscalationResolve = await prisma.refund.count({
      where: { customerId: customerAId },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/admin/internal-requests/${escalatedNumber}/resolve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ comment: 'Operational work completed separately.' })
      .expect(201);
    expect(await prisma.refund.count({ where: { customerId: customerAId } })).toBe(
      beforeEscalationResolve,
    );
    await request(app.getHttpServer())
      .post(`/api/v1/staff/support/${supportCaseNumber}/resolve`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ resolutionNote: 'The approved work is complete and the customer has been updated.' })
      .expect(201)
      .expect(({ body }) => {
        expect(body.status).toBe(SupportStatus.RESOLVED);
        expect(body.capabilities.canResolve).toBe(false);
      });

    const history = await prisma.internalRequestEvent.findMany({
      where: { internalRequestId: escalatedId },
      orderBy: { createdAt: 'asc' },
      select: { eventType: true, fromLevel: true, toLevel: true },
    });
    expect(history.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        InternalRequestEventType.CREATED,
        InternalRequestEventType.ESCALATED,
        InternalRequestEventType.RETURNED,
        InternalRequestEventType.RESOLVED,
      ]),
    );
    expect(history.find((event) => event.eventType === InternalRequestEventType.ESCALATED)).toEqual(
      expect.objectContaining({
        fromLevel: InternalRequestLevel.ADMIN,
        toLevel: InternalRequestLevel.SUPER_ADMIN,
      }),
    );

    const customerSupportView = await request(app.getHttpServer())
      .get(`/api/v1/customer/support/${supportCaseNumber}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(customerSupportView.body).not.toHaveProperty('internalRequests');
    expect(JSON.stringify(customerSupportView.body)).not.toContain(requestNumber);

    await waitUntil(async () =>
      Boolean(
        await prisma.auditLog.findFirst({
          where: {
            entityType: 'InternalRequest',
            entityId: requestNumber,
            action: 'EMAIL_DELIVERY_SENT',
            metadata: { path: ['purpose'], equals: 'INTERNAL_REQUEST_APPROVED' },
          },
        }),
      ),
    );
    const internalRequest = await prisma.internalRequest.findUniqueOrThrow({
      where: { requestNumber },
      include: { messages: true },
    });
    expect(internalRequest.messages.map((message) => message.body)).toEqual(
      expect.arrayContaining([
        'I am beginning the review.',
        'Confirm whether any credit has already been issued.',
        'No credit has been issued.',
        'Approved for separate processing.',
      ]),
    );
    const auditActions = await prisma.auditLog.findMany({
      where: { entityType: 'InternalRequest', entityId: internalRequest.id },
      select: { action: true, metadata: true },
    });
    expect(auditActions.map((entry) => entry.action)).toEqual(
      expect.arrayContaining([
        'INTERNAL_REQUEST_CREATED',
        'INTERNAL_REQUEST_TAKEN',
        'INTERNAL_REQUEST_REVIEW_STARTED',
        'INTERNAL_REQUEST_INFORMATION_REQUESTED',
        'INTERNAL_REQUEST_STAFF_REPLIED',
        'INTERNAL_REQUEST_APPROVED',
        'INTERNAL_REQUEST_RESOLVED',
        'INTERNAL_REQUEST_CLOSED',
      ]),
    );
    expect(JSON.stringify(auditActions)).not.toContain('No credit has been issued.');

    const concurrentCase = await request(app.getHttpServer())
      .post('/api/v1/customer/support')
      .set('Authorization', `Bearer ${customerToken}`)
      .field('category', 'ACCOUNT')
      .field('subject', 'Concurrent escalation and resolution')
      .field('message', 'Verify that only one conflicting workflow mutation can win.')
      .expect(201);
    const concurrentCaseId = concurrentCase.body.id as string;
    const concurrentCaseNumber = concurrentCase.body.caseNumber as string;
    await request(app.getHttpServer())
      .post(`/api/v1/staff/support/${concurrentCaseNumber}/take`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(201);
    const [createResult, resolveResult] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/staff/internal-requests')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          type: 'CUSTOMER_ACCOUNT_ACTION',
          title: 'Concurrent decision request',
          description: 'This request races with resolution to verify row-level serialization.',
          customerId: customerAId,
          supportCaseId: concurrentCaseId,
        }),
      request(app.getHttpServer())
        .post(`/api/v1/staff/support/${concurrentCaseNumber}/resolve`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ resolutionNote: 'Attempting a concurrent customer-facing resolution.' }),
    ]);
    expect([createResult.status, resolveResult.status].sort()).toEqual([201, 409]);
    const concurrentState = await prisma.supportCase.findUniqueOrThrow({
      where: { id: concurrentCaseId },
      select: { status: true, internalRequests: { select: { status: true } } },
    });
    if (concurrentState.status === SupportStatus.RESOLVED) {
      expect(concurrentState.internalRequests).toHaveLength(0);
    } else {
      expect(concurrentState.status).toBe(SupportStatus.IN_PROGRESS);
      expect(concurrentState.internalRequests).toEqual([
        expect.objectContaining({ status: InternalRequestStatus.PENDING }),
      ]);
    }
  }

  function postStripeEvent(event: Stripe.Event, signature = 'e2e-valid-signature') {
    return request(app.getHttpServer())
      .post('/api/v1/payments/stripe/webhook')
      .set('Stripe-Signature', signature)
      .send(event);
  }

  async function createPlan(
    name: string,
    downloadMbps: number,
    uploadMbps: number,
    monthlyCents: number,
  ): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/plans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name, downloadMbps, uploadMbps, monthlyCents })
      .expect(201);
    return response.body.id as string;
  }

  async function startUpgrade(subscriptionId: string, targetPlanId: string) {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/subscriptions/${subscriptionId}/plan-change`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ targetPlanId })
      .expect(201);
    const requestId = response.body.planChange.id as string;
    const planChange = await prisma.planChangeRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    const session = stripeSessions.get(planChange.stripeCheckoutSessionId as string);
    if (!session) throw new Error('Expected the fake plan-change Checkout session.');
    return { requestId, session };
  }

  async function loginAs(email: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return response.body.accessToken as string;
  }

  async function loginDirectAs(email: string): Promise<string> {
    const result = await app.get(AuthService).login({ email, password });
    return result.tokens.accessToken;
  }

  it('returns timezone-aware billing metrics and protects reports and exports by role', async () => {
    const summary = await request(app.getHttpServer())
      .get('/api/v1/admin/billing/reports/summary?preset=this_month')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(summary.body).toMatchObject({
      period: {
        timezone: 'Australia/Adelaide',
        generatedAt: expect.any(String),
      },
      metricBasis: {
        periodMetrics: expect.arrayContaining(['grossBilled', 'paymentsReceived']),
        snapshotMetrics: expect.arrayContaining(['outstanding', 'mrr']),
      },
      metrics: {
        netCashCollected: expect.objectContaining({ valueCents: expect.any(Number) }),
        activeServices: expect.objectContaining({ count: expect.any(Number) }),
      },
      tax: {
        gstBilledCents: expect.any(Number),
        gstAssociatedWithPaymentsCents: expect.any(Number),
      },
    });

    const receivables = await request(app.getHttpServer())
      .get('/api/v1/admin/billing/reports/receivables?preset=this_month')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(receivables.body.data).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ invoiceNumber: 'INV-2026-000002' })]),
    );

    await request(app.getHttpServer())
      .get('/api/v1/admin/billing/reports/summary?preset=this_month')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);

    const exported = await request(app.getHttpServer())
      .get('/api/v1/admin/billing/reports/revenue/export?preset=this_month&format=csv')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(200)
      .expect('Content-Type', /text\/csv/)
      .expect(
        'Content-Disposition',
        /mero-telecom-revenue-report-\d{4}-\d{2}(?:-\d{2}-to-\d{4}-\d{2}-\d{2})?\.csv/,
      );
    expect(exported.text.replace(/^\uFEFF/, '')).toContain(
      'Period,Gross Billed (AUD),Payments Received (AUD),Refunds Paid (AUD),Net Cash Collected (AUD)',
    );
    expect(exported.text).not.toContain('# organisation');

    const pdf = await request(app.getHttpServer())
      .get('/api/v1/admin/billing/reports/revenue/export?preset=this_month&format=pdf')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200)
      .expect('Content-Type', /application\/pdf/)
      .expect(
        'Content-Disposition',
        /mero-telecom-revenue-report-\d{4}-\d{2}(?:-\d{2}-to-\d{4}-\d{2}-\d{2})?\.pdf/,
      );
    expect((pdf.body as Buffer).subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  async function createActiveSubscription(customerId: string) {
    const currentPeriodStart = new Date();
    currentPeriodStart.setUTCDate(currentPeriodStart.getUTCDate() - 1);
    const billingAnchorDay = currentPeriodStart.getUTCDate();
    const currentPeriodEnd = new Date(currentPeriodStart);
    currentPeriodEnd.setUTCMonth(currentPeriodEnd.getUTCMonth() + 1, 1);
    const lastDay = new Date(
      Date.UTC(currentPeriodEnd.getUTCFullYear(), currentPeriodEnd.getUTCMonth() + 1, 0),
    ).getUTCDate();
    currentPeriodEnd.setUTCDate(Math.min(billingAnchorDay, lastDay));
    return prisma.subscription.create({
      data: {
        customerId,
        planId,
        startDate: currentPeriodStart,
        billingAnchorDay,
        currentPeriodStart,
        currentPeriodEnd,
        status: SubscriptionStatus.ACTIVE,
      },
    });
  }

  async function generateInvoice(subscriptionId: string, issueDate: string) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/invoices/generate')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ subscriptionId, issueDate })
      .expect(201);
    return response.body;
  }
});

function cookieFrom(value: string | string[] | undefined): string {
  const cookie = Array.isArray(value) ? value[0] : value;
  if (!cookie) throw new Error('Expected a refresh cookie.');
  return cookie.split(';')[0];
}

function stripeEvent(
  id: string,
  type:
    | 'checkout.session.completed'
    | 'checkout.session.async_payment_succeeded'
    | 'checkout.session.async_payment_failed'
    | 'checkout.session.expired',
  session: Stripe.Checkout.Session,
): Stripe.Event {
  return {
    id,
    object: 'event',
    api_version: '2026-07-29.dahlia',
    created: Math.floor(Date.now() / 1000),
    data: { object: session },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type,
  } as Stripe.Event;
}

function refundStripeEvent(
  id: string,
  type: 'refund.created' | 'refund.updated' | 'refund.failed',
  refund: Stripe.Refund,
): Stripe.Event {
  return {
    id,
    object: 'event',
    api_version: '2026-07-29.dahlia',
    created: Math.floor(Date.now() / 1000),
    data: { object: refund },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type,
  } as Stripe.Event;
}
