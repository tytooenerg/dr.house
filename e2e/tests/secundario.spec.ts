import { test, expect, dismissOnboardingIfPresent } from './fixtures';

// A conta demo já tem uma posição em aberto vinda de um leilão que fechou (server/src/db/seed.ts
// adjudica uma duplicata ao investidor demo). Comprar na hora deixou de existir — o vencedor
// do leilão primário só é conhecido no fechamento — então o anúncio de revenda parte da
// posição que a conta já tem, que é o mesmo ponto de partida de um investidor real.
test('demo investidor can list an owned position for resale on the mercado secundário', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('voce@empresa.com.br').fill('investidor@lastro.demo');
  await page.getByPlaceholder('••••••••').fill('demo1234');
  await page.locator('form').getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/app\/dashboard/);
  await dismissOnboardingIfPresent(page);

  await page.goto('/app/secundario', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Revenda posições antes do vencimento')).toBeVisible();

  const priceInput = page.getByPlaceholder('Preço de venda').first();
  await expect(priceInput).toBeVisible({ timeout: 10_000 });
  await priceInput.fill('1.000');
  await page.getByRole('button', { name: 'Anunciar' }).first().click();

  await expect(page.getByText('Seus anúncios')).toBeVisible();
});
