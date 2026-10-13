async (page) => {
  const responsePromise = page.waitForResponse(r => r.url().includes('/api/invoices/me/d8448073-a281-4c8d-9b33-3d80f8cebfc4/pdf'));
  const downloadPromise = page.waitForEvent('download', { timeout: 20000 });
  await page.getByRole('row').filter({hasText:'INV-2026-000002'}).getByRole('button', {name:'Download PDF'}).click();
  const [response, download] = await Promise.all([responsePromise, downloadPromise]);
  await download.saveAs('D:/MeroTelecom/output/playwright/customer-audit-2026-10-12/verified-invoice-after-fix.pdf');
  return {status:response.status(),contentType:response.headers()['content-type'],disposition:response.headers()['content-disposition']??null,downloadName:download.suggestedFilename(),failure:await download.failure()};
}
