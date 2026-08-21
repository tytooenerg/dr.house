import { test, expect, dismissOnboardingIfPresent } from './fixtures';

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

test('a básico cedente can generate a sandbox key on Desenvolvedores, but live keys require upgrading to Empresarial', async ({ page }) => {
  const suffix = unique();

  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await page.getByText('Empresa (cedente)').click();
  await page.getByPlaceholder('Marina Costa').fill('Cedente Teste');
  await page.getByPlaceholder('Sua empresa Ltda').fill(`Cedente Billing ${suffix}`);
  await page.getByPlaceholder('voce@empresa.com.br').fill(`cedente-billing-${suffix}@example.com`);
  await page.getByPlaceholder('mínimo 6 caracteres').fill('senha123');
  await page.getByRole('button', { name: 'Criar conta e entrar' }).click();
  await dismissOnboardingIfPresent(page);
  await expect(page).toHaveURL(/\/app\//, { timeout: 15_000 });

  // Desenvolvedores is reachable on any plan now (free sandbox tier) — a fresh Básico
  // account can generate a sandbox key, but a live key still requires Empresarial.
  await page.goto('/app/dev', { waitUntil: 'domcontentloaded' });
  await dismissOnboardingIfPresent(page);
  await expect(page.getByText('Chave de API', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: /Gerar chave de produção/ }).click();
  await expect(page.getByText('Chaves de produção requerem o plano Empresarial')).toBeVisible();

  await page.goto('/app/assinatura', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Modo demo — Stripe não configurado')).toBeVisible();

  const empresarialCard = page.getByText('Empresarial', { exact: true }).locator('..');
  await empresarialCard.getByRole('button', { name: 'Fazer upgrade' }).click();
  await expect(page.getByText(/Plano empresarial ativado/)).toBeVisible({ timeout: 10_000 });

  // Now a live key can be generated for real.
  await page.goto('/app/dev', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Gerar chave de produção/ }).click();
  await expect(page.getByText('Guarde essa chave agora')).toBeVisible();
});
