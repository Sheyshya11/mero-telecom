import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { assertNonProductionDatabaseCommand } from '../src/scripts/database-command-safety';

const prisma = new PrismaClient();
const demoPassword = 'ChangeMe123!';

async function main(): Promise<void> {
  assertNonProductionDatabaseCommand(process.env.NODE_ENV, 'Development demo seed');
  const passwordHash = await hash(demoPassword, 12);

  await prisma.$transaction([
    prisma.paymentWebhookEvent.deleteMany(),
    prisma.planChangeRequest.deleteMany(),
    prisma.accountInvitation.deleteMany(),
    prisma.staffInvitation.deleteMany(),
    prisma.checkoutApplication.deleteMany(),
    prisma.coverageSearch.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.invoiceDocument.deleteMany(),
    prisma.invoiceItem.deleteMany(),
    prisma.invoice.deleteMany(),
    prisma.subscription.deleteMany(),
    prisma.planCoverageRule.deleteMany(),
    prisma.addressCoverageOverride.deleteMany(),
    prisma.postcodeCoverage.deleteMany(),
    prisma.operatingRegion.deleteMany(),
    prisma.internetPlan.deleteMany(),
    prisma.refreshSession.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.customerAddress.deleteMany(),
    prisma.customer.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  const [admin, newCustomerUser, staff, customerUser] = await Promise.all([
    prisma.user.create({
      data: {
        email: 'admin@merotelecom.test',
        passwordHash,
        role: 'ADMIN',
      },
    }),
    prisma.user.create({
      data: {
        email: 'newcustomer@merotelecom.test',
        passwordHash,
        role: 'CUSTOMER',
      },
    }),
    prisma.user.create({
      data: {
        email: 'staff@merotelecom.test',
        passwordHash,
        role: 'STAFF',
      },
    }),
    prisma.user.create({
      data: {
        email: 'customer@merotelecom.test',
        passwordHash,
        role: 'CUSTOMER',
      },
    }),
  ]);

  const [essentialPlan, familyPlan, businessPlan] = await Promise.all([
    prisma.internetPlan.create({
      data: {
        name: 'Essential 50',
        description: 'Reliable everyday internet for a connected household.',
        downloadMbps: 50,
        uploadMbps: 20,
        monthlyCents: 6900,
        tierRank: 1,
      },
    }),
    prisma.internetPlan.create({
      data: {
        name: 'Family 100',
        description: 'Extra capacity for streaming, gaming, and working from home.',
        downloadMbps: 100,
        uploadMbps: 20,
        monthlyCents: 7900,
        tierRank: 2,
      },
    }),
    prisma.internetPlan.create({
      data: {
        name: 'Business 250',
        description: 'High-performance connectivity for small businesses.',
        downloadMbps: 250,
        uploadMbps: 25,
        monthlyCents: 10900,
        tierRank: 3,
      },
    }),
  ]);

  const southAustralia = await prisma.operatingRegion.create({
    data: {
      countryCode: 'AU',
      stateCode: 'SA',
      name: 'South Australia',
      status: 'ACTIVE',
    },
  });

  await Promise.all([
    prisma.postcodeCoverage.create({
      data: {
        operatingRegionId: southAustralia.id,
        postcode: '5000',
        status: 'AVAILABLE',
        technology: 'FTTP',
        maximumSpeedMbps: 1000,
        adminNotes: 'Deterministic Adelaide CBD demonstration fixture; not an nbn SQ result.',
      },
    }),
    prisma.postcodeCoverage.create({
      data: {
        operatingRegionId: southAustralia.id,
        postcode: '5001',
        status: 'PARTIAL',
        technology: 'FTTC',
        maximumSpeedMbps: 100,
        adminNotes: 'Deterministic partial-coverage demonstration fixture.',
      },
    }),
    prisma.postcodeCoverage.create({
      data: {
        operatingRegionId: southAustralia.id,
        postcode: '5114',
        status: 'COMING_SOON',
        availabilityDate: new Date('2027-03-01T00:00:00.000Z'),
        adminNotes: 'Deterministic coming-soon demonstration fixture.',
      },
    }),
    prisma.addressCoverageOverride.create({
      data: {
        operatingRegionId: southAustralia.id,
        provider: 'geoapify',
        providerAddressId: 'fixture-unavailable-12-king-william-adelaide',
        formattedAddress: '12 King William Street, Adelaide SA 5000, Australia',
        stateCode: 'SA',
        postcode: '5000',
        status: 'UNAVAILABLE',
        adminNotes: 'Deterministic address override fixture for automated tests.',
      },
    }),
  ]);

  const planTechnologyRules = [
    [essentialPlan.id, 'FTTP'],
    [familyPlan.id, 'FTTP'],
    [businessPlan.id, 'FTTP'],
    [essentialPlan.id, 'FTTN'],
    [familyPlan.id, 'FTTN'],
    [essentialPlan.id, 'FTTC'],
    [familyPlan.id, 'FTTC'],
    [essentialPlan.id, 'HFC'],
    [familyPlan.id, 'HFC'],
    [businessPlan.id, 'HFC'],
    [essentialPlan.id, 'FIXED_WIRELESS'],
    [familyPlan.id, 'FIXED_WIRELESS'],
  ] as const;
  await prisma.planCoverageRule.createMany({
    data: planTechnologyRules.map(([planId, technology]) => ({
      planId,
      technology,
      operatingRegionId: southAustralia.id,
      scopeKey: `region:${southAustralia.id}:postcode:*`,
      maximumSpeedMbps: technology === 'FIXED_WIRELESS' ? 100 : null,
    })),
  });

  const [anika, noah, olivia] = await Promise.all([
    prisma.customer.create({
      data: {
        userId: customerUser.id,
        customerNumber: 'CUST-000001',
        firstName: 'Anika',
        lastName: 'Singh',
        email: customerUser.email,
        phone: '0400 000 001',
        addressLine1: '15 King William Street',
        suburb: 'Adelaide',
        state: 'SA',
        postcode: '5000',
      },
    }),
    prisma.customer.create({
      data: {
        customerNumber: 'CUST-000002',
        firstName: 'Noah',
        lastName: 'Martinez',
        email: 'noah.martinez@merotelecom.test',
        phone: '0400 000 002',
        addressLine1: '8 Prospect Road',
        suburb: 'Prospect',
        state: 'SA',
        postcode: '5082',
      },
    }),
    prisma.customer.create({
      data: {
        customerNumber: 'CUST-000003',
        firstName: 'Olivia',
        lastName: 'Chen',
        email: 'olivia.chen@merotelecom.test',
        phone: '0400 000 003',
        addressLine1: '42 The Parade',
        suburb: 'Norwood',
        state: 'SA',
        postcode: '5067',
      },
    }),
  ]);

  await prisma.customer.create({
    data: {
      userId: newCustomerUser.id,
      customerNumber: 'CUST-000004',
      firstName: 'Maya',
      lastName: 'Patel',
      email: newCustomerUser.email,
      phone: '0400 000 004',
      addressLine1: '21 Jetty Road',
      suburb: 'Glenelg',
      state: 'SA',
      postcode: '5045',
    },
  });

  const [anikaSubscription, noahSubscription] = await Promise.all([
    prisma.subscription.create({
      data: {
        customerId: anika.id,
        planId: essentialPlan.id,
        status: 'ACTIVE',
        startDate: new Date('2026-01-01'),
        billingAnchorDay: 1,
        currentPeriodStart: new Date('2026-08-01T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
      },
    }),
    prisma.subscription.create({
      data: {
        customerId: noah.id,
        planId: familyPlan.id,
        status: 'ACTIVE',
        startDate: new Date('2025-11-01'),
        billingAnchorDay: 1,
        currentPeriodStart: new Date('2026-08-01T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
      },
    }),
  ]);

  await prisma.subscription.create({
    data: {
      customerId: olivia.id,
      planId: businessPlan.id,
      status: 'PENDING',
      startDate: new Date('2026-09-01'),
      billingAnchorDay: 1,
      currentPeriodStart: new Date('2026-09-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-10-01T00:00:00.000Z'),
    },
  });

  const paidInvoice = await prisma.invoice.create({
    data: {
      invoiceNumber: 'INV-2026-000001',
      customerId: anika.id,
      subscriptionId: anikaSubscription.id,
      issueDate: new Date('2026-01-01'),
      dueDate: new Date('2026-01-15'),
      subtotalCents: 6273,
      taxCents: 627,
      totalCents: 6900,
      status: 'PAID',
      issuedAt: new Date('2026-01-01T09:00:00.000Z'),
      paidAt: new Date('2026-01-05T10:30:00.000Z'),
      items: {
        create: {
          description: 'Essential 50 monthly service — January 2026',
          quantity: 1,
          unitPriceCents: 6900,
          amountCents: 6900,
        },
      },
    },
  });

  await Promise.all([
    prisma.payment.create({
      data: {
        invoiceId: paidInvoice.id,
        customerId: anika.id,
        provider: 'MANUAL',
        providerPaymentId: 'DEMO-MANUAL-000001',
        amountCents: 6900,
        status: 'SUCCEEDED',
        paidAt: new Date('2026-01-05T10:30:00.000Z'),
      },
    }),
    prisma.invoice.create({
      data: {
        invoiceNumber: 'INV-2026-000002',
        customerId: anika.id,
        subscriptionId: anikaSubscription.id,
        issueDate: new Date('2026-08-01'),
        dueDate: new Date('2026-08-15'),
        subtotalCents: 6273,
        taxCents: 627,
        totalCents: 6900,
        status: 'ISSUED',
        issuedAt: new Date('2026-08-01T09:00:00.000Z'),
        items: {
          create: {
            description: 'Essential 50 monthly service — August 2026',
            quantity: 1,
            unitPriceCents: 6900,
            amountCents: 6900,
          },
        },
      },
    }),
    prisma.invoice.create({
      data: {
        invoiceNumber: 'INV-2026-000003',
        customerId: noah.id,
        subscriptionId: noahSubscription.id,
        issueDate: new Date('2026-07-01'),
        dueDate: new Date('2026-07-15'),
        subtotalCents: 7182,
        taxCents: 718,
        totalCents: 7900,
        status: 'OVERDUE',
        issuedAt: new Date('2026-07-01T09:00:00.000Z'),
        items: {
          create: {
            description: 'Family 100 monthly service — July 2026',
            quantity: 1,
            unitPriceCents: 7900,
            amountCents: 7900,
          },
        },
      },
    }),
  ]);

  await prisma.auditLog.create({
    data: {
      actorUserId: admin.id,
      action: 'SEED_DATA_CREATED',
      entityType: 'System',
      entityId: 'development-database',
      metadata: { createdBy: 'prisma-seed', staffUserId: staff.id },
    },
  });

  const [
    userCount,
    customerCount,
    planCount,
    subscriptionCount,
    invoiceCount,
    paymentCount,
    postcodeCoverageCount,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.customer.count(),
    prisma.internetPlan.count(),
    prisma.subscription.count(),
    prisma.invoice.count(),
    prisma.payment.count(),
    prisma.postcodeCoverage.count(),
  ]);

  console.log(
    `Seeded ${userCount} users, ${customerCount} customers, ${planCount} internet plans, ` +
      `${subscriptionCount} subscriptions, ${invoiceCount} invoices, and ${paymentCount} payment.`,
    ` Coverage fixtures include ${postcodeCoverageCount} exact South Australian postcodes.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error('Database seed failed.', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
