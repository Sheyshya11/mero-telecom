async (page) => {
  const routes = ['/customer/support', '/customer/refunds', '/customer/profile', '/customer/subscription/moving-home', '/account/security', '/notifications'];
  const failures = []; const results = [];
  page.on('pageerror', error => failures.push(error.message));
  for (const route of routes) {
    await page.goto('http://localhost:3000' + route);
    await page.waitForLoadState('networkidle');
    await page.getByRole('navigation', { name: 'My account navigation' }).waitFor({ timeout: 15000 });
    const text = await page.locator('main').innerText();
    const name = route.replaceAll('/', '_').slice(1);
    await page.screenshot({ path: 'D:/MeroTelecom/output/playwright/customer-audit-2026-10-12/' + name + '.png', fullPage: true });
    results.push({ route, text });
  }
  return { screens: results, pageErrors: failures };
}

