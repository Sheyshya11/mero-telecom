export interface InvoiceEmailTemplateData {
  invoiceNumber: string;
  customerName: string;
  dueDate: Date;
  totalCents: number;
  currency: string;
}

export interface RenderedEmailTemplate {
  subject: string;
  text: string;
  html: string;
}

export function renderInvoiceEmail(data: InvoiceEmailTemplateData): RenderedEmailTemplate {
  const dueDate = new Intl.DateTimeFormat('en-AU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(data.dueDate);
  const total = new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: data.currency,
  }).format(data.totalCents / 100);
  const customerName = escapeHtml(data.customerName);
  const invoiceNumber = escapeHtml(data.invoiceNumber);
  const escapedDueDate = escapeHtml(dueDate);
  const escapedTotal = escapeHtml(total);

  return {
    subject: `Mero Telecom invoice ${data.invoiceNumber}`,
    text: [
      `Hello ${data.customerName},`,
      '',
      `Your Mero Telecom invoice ${data.invoiceNumber} is attached.`,
      `Total: ${total}`,
      `Due date: ${dueDate}`,
      '',
      'Thank you for choosing Mero Telecom.',
    ].join('\n'),
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a">
    <div style="max-width:600px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden">
      <div style="background:#075985;padding:24px;color:#fff">
        <div style="font-size:22px;font-weight:700">MERO TELECOM</div>
        <div style="margin-top:4px;font-size:13px">Invoice delivery</div>
      </div>
      <div style="padding:28px">
        <p>Hello ${customerName},</p>
        <p>Your invoice <strong>${invoiceNumber}</strong> is attached as a PDF.</p>
        <table role="presentation" style="width:100%;margin:24px 0;border-collapse:collapse">
          <tr><td style="padding:10px;background:#e0f2fe">Total</td><td style="padding:10px;background:#e0f2fe;text-align:right;font-weight:700">${escapedTotal}</td></tr>
          <tr><td style="padding:10px;border-bottom:1px solid #e2e8f0">Due date</td><td style="padding:10px;border-bottom:1px solid #e2e8f0;text-align:right">${escapedDueDate}</td></tr>
        </table>
        <p style="color:#475569">Thank you for choosing Mero Telecom.</p>
      </div>
    </div>
  </body>
</html>`,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    };
    return entities[character];
  });
}
