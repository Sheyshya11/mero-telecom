async (page) => {
  await page.reload();
  await page.getByLabel('New plan').selectOption('794d471c-0d90-478f-a774-a3f214b61be1');
  await page.getByRole('button', {name:'Preview plan change'}).click();
  await page.getByRole('heading', {name:'Upgrade preview'}).waitFor();
  await page.screenshot({path:'D:/MeroTelecom/output/playwright/customer-audit-2026-10-12/upgrade-preview-after-fix.png',fullPage:true});
  return {automaticPaymentSetupEnabled:await page.getByRole('button',{name:'Enable automatic payments'}).isEnabled(),expiryMessage:await page.getByRole('alert').filter({hasText:'This plan change'}).innerText(),upgradePreviewVisible:await page.getByRole('heading',{name:'Upgrade preview'}).isVisible()};
}
