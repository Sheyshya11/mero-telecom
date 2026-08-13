import { InvoicePdfService } from './invoice-pdf.service';

describe('InvoicePdfService', () => {
  it('renders a valid PDF document from invoice data', async () => {
    const service = new InvoicePdfService();
    const pdf = await service.render({
      invoiceNumber: 'INV-2026-000001',
      issueDate: new Date('2026-01-01T00:00:00.000Z'),
      dueDate: new Date('2026-01-15T00:00:00.000Z'),
      subtotalCents: 6273,
      taxCents: 627,
      totalCents: 6900,
      currency: 'AUD',
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
      subscription: { plan: { name: 'Essential 50' } },
      items: [
        {
          description: 'Essential 50 monthly internet service - January 2026',
          quantity: 1,
          unitPriceCents: 6900,
          amountCents: 6900,
        },
      ],
    });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
