import { test, expect, dismissOnboardingIfPresent } from './fixtures';

async function loginAsInvestidor(page: import('@playwright/test').Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('voce@empresa.com.br').fill('investidor@lastro.demo');
  await page.getByPlaceholder('••••••••').fill('demo1234');
  await page.locator('form').getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/app\/dashboard/);
  await dismissOnboardingIfPresent(page);
}

test('investidor can browse the live marketplace and buy an offer', async ({ page }) => {
  await loginAsInvestidor(page);
  await page.goto('/app/marketplace', { waitUntil: 'domcontentloaded' });
  await dismissOnboardingIfPresent(page);

  await expect(page.getByText('Atualizações ao vivo')).toBeVisible({ timeout: 15_000 });

  const buyButton = page.getByRole('button', { name: 'Comprar' }).first();
  await expect(buyButton).toBeVisible();
  await buyButton.click();

  await expect(page.getByRole('button', { name: 'Comprada' }).first()).toBeVisible({ timeout: 10_000 });
});

test('investidor opens funding-matching explainability ("Por que essa oferta?") on a live offer', async ({ page }) => {
  await loginAsInvestidor(page);
  await page.goto('/app/marketplace', { waitUntil: 'domcontentloaded' });
  await dismissOnboardingIfPresent(page);
  await expect(page.getByText('Atualizações ao vivo')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Por que essa oferta?' }).first().click();
  await expect(page.getByText('Por que essa oferta tem esse preço')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Score de risco do sacado')).toBeVisible();
  await expect(page.getByText(/Condição de mercado/)).toBeVisible();
});
