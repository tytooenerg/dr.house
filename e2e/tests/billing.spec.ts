import { test, expect, dismissOnboardingIfPresent } from './fixtures';

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

test('a básico cedente sees an upgrade prompt on Desenvolvedores, then unlocks it after upgrading to Empresarial', async ({ page }) => {
  const suffix = unique();

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await page.getByText('Empresa (cedente)').click();
  await page.getByPlaceholder('Marina Costa').fill('Cedente Teste');
  await page.getByPlaceholder('Sua empresa Ltda').fill(`Cedente Billing ${suffix}`);
  await page.getByPlaceholder('voce@empresa.com.br').fill(`cedente-billing-${suffix}@example.com`);
  await page.getByPlaceholder('mínimo 6 caracteres').fill('senha123');
  await page.getByRole('button', { name: 'Criar conta e entrar' }).click();
  await dismissOnboardingIfPresent(page);
  await expect(page).toHaveURL(/\/app\//, { timeout: 15_000 });

  // Desenvolvedores (dev) is cedente-accessible but gated behind Empresarial — a fresh
  // account is on Básico, so it should show the upgrade prompt instead of the real page.
  await page.goto('/app/dev', { waitUntil: 'domcontentloaded' });
  await dismissOnboardingIfPresent(page);
  await expect(page.getByText('Ambiente de Desenvolvedores é um recurso Empresarial')).toBeVisible();

  await page.getByRole('button', { name: 'Ver planos' }).click();
  await expect(page).toHaveURL(/\/app\/assinatura/);
  await expect(page.getByText('Modo demo — Stripe não configurado')).toBeVisible();

  const empresarialCard = page.getByText('Empresarial', { exact: true }).locator('..');
  await empresarialCard.getByRole('button', { name: 'Fazer upgrade' }).click();
  await expect(page.getByText(/Plano empresarial ativado/)).toBeVisible({ timeout: 10_000 });

  // Now Desenvolvedores should render for real instead of the upgrade prompt.
  await page.goto('/app/dev', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Chaves de API', { exact: true })).toBeVisible();
});
