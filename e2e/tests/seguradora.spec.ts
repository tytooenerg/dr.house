import { test, expect, dismissOnboardingIfPresent } from './fixtures';

test('demo seguradora sees the seeded policy/sinistro and can approve a claim', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('voce@empresa.com.br').fill('seguradora@lastro.demo');
  await page.getByPlaceholder('••••••••').fill('demo1234');
  await page.locator('form').getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/app\/seguradora/, { timeout: 15_000 });
  await dismissOnboardingIfPresent(page);

  await expect(page.getByText('Too Seguros')).toBeVisible();
  await expect(page.getByText('Sinistros aguardando decisão')).toBeVisible();

  const claimCard = page.locator('div', { hasText: 'não pagou' }).first();
  await claimCard.getByPlaceholder('Nota da decisão').fill('Documentação conferida, indenização aprovada.');
  await claimCard.getByRole('button', { name: 'Aprovar e indenizar' }).click();

  await expect(page.getByText('Nenhum sinistro em aberto')).toBeVisible({ timeout: 10_000 });
});
