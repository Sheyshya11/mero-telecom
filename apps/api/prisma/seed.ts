import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();
const demoPassword = 'ChangeMe123!';

async function main(): Promise<void> {
  const passwordHash = await hash(demoPassword, 12);

  await prisma.$transaction([
    prisma.paymentWebhookEvent.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.invoiceItem.deleteMany(),
    prisma.invoice.deleteMany(),
    prisma.subscription.deleteMany(),
    prisma.internetPlan.deleteMany(),
    prisma.refreshSession.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.customer.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  const [admin, staff, customerUser] = await Promise.all([
    prisma.user.create({
      data: {
        email: 'admin@merotelecom.test',
        passwordHash,
        role: 'ADMIN',
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
      },
    }),
    prisma.internetPlan.create({
      data: {
        name: 'Family 100',
        description: 'Extra capacity for streaming, gaming, and working from home.',
        downloadMbps: 100,
        uploadMbps: 20,
        monthlyCents: 7900,
      },
    }),
    prisma.internetPlan.create({
      data: {
        name: 'Business 250',
        description: 'High-performance connectivity for small businesses.',
        downloadMbps: 250,
        uploadMbps: 25,
        monthlyCents: 10900,
      },
    }),
  ]);

  const [anika, noah, olivia] = await Promise.all([
    prisma.customer.create({
      data: {
        userId: customerUser.id,
        customerNumber: 'CUST-000001',
        firstName: 'Anika',
        lastName: 'Singh',
        email: customerUser.email,
        phone: '0400 000 001',
        addressLine1: '15 Harbour Street',
        suburb: 'Sydney',
        state: 'NSW',
        postcode: '2000',
      },
    }),
    prisma.customer.create({
      data: {
        customerNumber: 'CUST-000002',
        firstName: 'Noah',
        lastName: 'Martinez',
        email: 'noah.martinez@merotelecom.test',
        phone: '0400 000 002',
        addressLine1: '8 King Street',
        suburb: 'Parramatta',
        state: 'NSW',
        postcode: '2150',
      },
    }),
    prisma.customer.create({
      data: {
        customerNumber: 'CUST-000003',
        firstName: 'Olivia',
        lastName: 'Chen',
        email: 'olivia.chen@merotelecom.test',
        phone: '0400 000 003',
        addressLine1: '42 Station Road',
        suburb: 'Chatswood',
        state: 'NSW',
        postcode: '2067',
      },
    }),
  ]);

  const [anikaSubscription, noahSubscription] = await Promise.all([
    prisma.subscription.create({
      data: {
        customerId: anika.id,
        planId: essentialPlan.id,
        status: 'ACTIVE',
        startDate: new Date('2026-01-01'),
      },
    }),
    prisma.subscription.create({
      data: {
        customerId: noah.id,
        planId: familyPlan.id,
        status: 'ACTIVE',
        startDate: new Date('2025-11-01'),
      },
    }),
  ]);

  await prisma.subscription.create({
    data: {
      customerId: olivia.id,
      planId: businessPlan.id,
      status: 'PENDING',
      startDate: new Date('2026-09-01'),
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

  const [userCount, customerCount, planCount, subscriptionCount, invoiceCount, paymentCount] =
    await Promise.all([
      prisma.user.count(),
      prisma.customer.count(),
      prisma.internetPlan.count(),
      prisma.subscription.count(),
      prisma.invoice.count(),
      prisma.payment.count(),
    ]);

  console.log(
    `Seeded ${userCount} users, ${customerCount} customers, ${planCount} internet plans, ` +
      `${subscriptionCount} subscriptions, ${invoiceCount} invoices, and ${paymentCount} payment.`,
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
