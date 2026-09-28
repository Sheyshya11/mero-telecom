import { InvoicePdfService, type InvoicePdfData } from './invoice-pdf.service';

const invoice: InvoicePdfData = {
  invoiceNumber: 'INV-2026-000001',
  issueDate: new Date('2026-01-01T00:00:00.000Z'),
  dueDate: new Date('2026-01-15T00:00:00.000Z'),
  subtotalCents: 6273,
  taxCents: 627,
  totalCents: 6900,
  currency: 'AUD',
  status: 'PAID',
  customer: {
    customerNumber: 'CUST-000001',
    firstName: 'Anika',
    lastName: 'Singh',
    email: 'anika@example.test',
    addressLine1: '15 Harbour Street',
    addressLine2: null,
    suburb: 'Sydney',
    state: 'NSW',
    postcode: '2000',
  },
  subscription: { billingMode: 'STRIPE_RECURRING', plan: { name: 'Essential 50' } },
  items: [
    {
      description: 'Essential 50 monthly internet service - January 2026',
      quantity: 1,
      unitPriceCents: 6900,
      amountCents: 6900,
    },
  ],
};

describe('InvoicePdfService', () => {
  it('renders a valid PDF document from invoice data', async () => {
    const service = new InvoicePdfService();
    const pdf = await service.render(invoice);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('labels BECS and fully credit-settled invoices without exposing bank details', () => {
    const service = new InvoicePdfService() as unknown as {
      paymentMethodLabel(
        payment:
          | {
              paymentMethodType: 'CARD' | 'AU_BECS_DEBIT' | null;
              paymentMethodBrand: string | null;
              paymentMethodLast4: string | null;
            }
          | undefined,
        invoice: InvoicePdfData,
      ): string;
    };

    expect(
      service.paymentMethodLabel(
        {
          paymentMethodType: 'AU_BECS_DEBIT',
          paymentMethodBrand: null,
          paymentMethodLast4: '4821',
        },
        invoice,
      ),
    ).toBe('Direct Debit •••• 4821');
    expect(
      service.paymentMethodLabel(undefined, {
        ...invoice,
        totalCents: 0,
        items: [
          ...invoice.items,
          {
            description: 'Account credits applied',
            quantity: 1,
            unitPriceCents: -6900,
            amountCents: -6900,
          },
        ],
      }),
    ).toBe('Settled by account credit');
  });
});
