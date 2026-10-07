import { test, expect, dismissOnboardingIfPresent } from './fixtures';

test('admin abre a aba Indicadores e vê os números do mês, o histórico e a carteira', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('voce@empresa.com.br').fill('admin@lastro.demo');
  await page.getByPlaceholder('••••••••').fill('demo1234');
  await page.locator('form').getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/app\/admin/, { timeout: 15_000 });
  await dismissOnboardingIfPresent(page);

  await page.getByRole('link', { name: 'Indicadores' }).click();
  await expect(page).toHaveURL(/\/app\/admin\/indicadores/);
  await expect(page.getByText(/Indicadores do mês —/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Volume (GMV)')).toBeVisible();
  await expect(page.getByText(/Últimos 6 meses/)).toBeVisible();
  await expect(page.getByText('Carteira em aberto — hoje')).toBeVisible();
  await expect(page.getByText('Fora da plataforma', { exact: true })).toBeVisible();
});
