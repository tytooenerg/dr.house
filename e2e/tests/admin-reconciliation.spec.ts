import { test, expect, dismissOnboardingIfPresent } from './fixtures';

test('admin runs the reconciliation scan from the back-office and sees a result', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('voce@empresa.com.br').fill('admin@lastro.demo');
  await page.getByPlaceholder('••••••••').fill('demo1234');
  await page.locator('form').getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/app\/admin/, { timeout: 15_000 });
  await dismissOnboardingIfPresent(page);

  await page.getByRole('button', { name: 'Reconciliação' }).click();
  await expect(page.getByText('Reconciliação de pagamentos')).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: 'Rodar reconciliação agora' }).click();
  await expect(page.getByText(/eventos checados/)).toBeVisible({ timeout: 15_000 });

  // The manual bank-statement (OFX) upload card is also on this tab.
  await expect(page.getByText('Reconciliar extrato bancário real (OFX)')).toBeVisible();
});
