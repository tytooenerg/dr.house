import { test, expect } from './fixtures';

test('demo investidor can buy an offer, then list it for resale on the mercado secundário', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('voce@empresa.com.br').fill('investidor@lastro.demo');
  await page.getByPlaceholder('••••••••').fill('demo1234');
  await page.locator('form').getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/app\/dashboard/);
  const skipOnboarding = page.getByRole('button', { name: 'Pular' });
  if (await skipOnboarding.isVisible().catch(() => false)) await skipOnboarding.click();

  await page.goto('/app/marketplace', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Atualizações ao vivo')).toBeVisible({ timeout: 15_000 });
  const buyButton = page.getByRole('button', { name: 'Comprar' }).first();
  if (await buyButton.isVisible().catch(() => false)) {
    await buyButton.click();
    await expect(page.getByRole('button', { name: 'Comprada' }).first()).toBeVisible({ timeout: 10_000 });
  }

  await page.goto('/app/secundario', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Revenda posições antes do vencimento')).toBeVisible();

  const priceInput = page.getByPlaceholder('Preço de venda').first();
  await expect(priceInput).toBeVisible({ timeout: 10_000 });
  await priceInput.fill('1.000');
  await page.getByRole('button', { name: 'Anunciar' }).first().click();

  await expect(page.getByText('Seus anúncios')).toBeVisible();
});
