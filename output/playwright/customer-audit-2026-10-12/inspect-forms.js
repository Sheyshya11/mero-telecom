async (page) => {
  const results = [];
  for (const [route, button] of [
    ['/customer/support', 'Contact Support'],
    ['/customer/refunds', 'Request refund'],
    ['/customer/subscription', 'Cancel Service']
  ]) {
    await page.goto('http://localhost:3000' + route);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: button, exact: true }).first().click();
    await page.waitForLoadState('networkidle');
    results.push({ route, opened: button, text: await page.locator('main').innerText() });
  }
  return results;
}
