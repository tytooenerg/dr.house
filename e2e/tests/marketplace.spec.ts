import { test, expect } from './fixtures';

async function loginAsInvestidor(page: import('@playwright/test').Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('voce@empresa.com.br').fill('investidor@lastro.demo');
  await page.getByPlaceholder('••••••••').fill('demo1234');
  await page.locator('form').getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/app\/dashboard/);

  const skipOnboarding = page.getByRole('button', { name: 'Pular' });
  if (await skipOnboarding.isVisible().catch(() => false)) await skipOnboarding.click();
}

test('investidor can browse the live marketplace and buy an offer', async ({ page }) => {
  await loginAsInvestidor(page);
  await page.goto('/app/marketplace', { waitUntil: 'domcontentloaded' });

  await expect(page.getByText('Atualizações ao vivo')).toBeVisible({ timeout: 15_000 });

  const buyButton = page.getByRole('button', { name: 'Comprar' }).first();
  await expect(buyButton).toBeVisible();
  await buyButton.click();

  await expect(page.getByRole('button', { name: 'Comprada' }).first()).toBeVisible({ timeout: 10_000 });
});
