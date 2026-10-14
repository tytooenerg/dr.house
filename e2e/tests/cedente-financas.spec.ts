import { test, expect, dismissOnboardingIfPresent } from './fixtures';
import type { Page } from '@playwright/test';

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerCedente(page: Page) {
  const suffix = unique();
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await page.getByText('Empresa (cedente)').click();
  await page.getByPlaceholder('Marina Costa').fill('Cedente Finanças');
  await page.getByPlaceholder('Sua empresa Ltda').fill(`Cedente Finanças ${suffix}`);
  await page.getByPlaceholder('voce@empresa.com.br').fill(`cedente-financas-${suffix}@example.com`);
  await page.getByPlaceholder('mínimo 6 caracteres').fill('senha123');
  // Empresa e sacado informam o CNPJ no cadastro — o botão só libera com um CNPJ válido.
  await page.getByRole('textbox', { name: 'CNPJ da empresa' }).fill('11.444.777/0001-61');
  await expect(page.getByText(/CNPJ válido/)).toBeVisible();
  await page.getByRole('button', { name: 'Criar conta e entrar' }).click();
  await expect(page).toHaveURL(/\/app\//, { timeout: 15_000 });
  await dismissOnboardingIfPresent(page);
}

test('a cedente adds a payable, marks it paid, and sees it reflected in the AI CFO forecast', async ({ page }) => {
  await registerCedente(page);

  // Contas a Pagar: create one real obligation.
  await page.goto('/app/contas-pagar', { waitUntil: 'domcontentloaded' });
  await dismissOnboardingIfPresent(page);
  await page.getByRole('button', { name: '+ Nova conta' }).click();
  await page.getByPlaceholder('Descrição').fill('Aluguel do escritório');
  await page.getByPlaceholder('Valor em R$').fill('4500');
  await page.locator('input[type="date"]').fill('2026-12-15');
  await page.getByRole('button', { name: 'Salvar' }).click();

  await expect(page.getByText('Aluguel do escritório')).toBeVisible({ timeout: 10_000 });

  // Mark it paid and confirm the status flips — it should no longer show pay/cancel actions.
  await page.getByRole('button', { name: 'Marcar pago' }).click();
  await expect(page.getByText('Pago')).toBeVisible({ timeout: 10_000 });

  // AI CFO requires at least the Pro plan (feature "CFO fica atrás de Pro/Empresarial") —
  // a fresh Básico account upgrades through the real Assinatura flow first.
  await page.goto('/app/assinatura', { waitUntil: 'domcontentloaded' });
  const proCard = page.getByText('Pro', { exact: true }).locator('..');
  await proCard.getByRole('button', { name: 'Fazer upgrade' }).click();
  await expect(page.getByText(/Plano pro ativado/i)).toBeVisible({ timeout: 10_000 });

  // AI CFO: the forecast page loads and renders real projected-balance data (not blank).
  await page.goto('/app/ai-cfo', { waitUntil: 'domcontentloaded' });
  await dismissOnboardingIfPresent(page);
  await expect(page.getByText('Saldo de caixa projetado')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Disponível para antecipar hoje')).toBeVisible();
  await expect(page.getByText('Insights')).toBeVisible();
});

// Piloto automático (server/src/lib/pilotoAutomatico.ts): a empresa liga o leilão automático
// em Conta & Liquidação, escolhe a taxa máxima, e a escolha sobrevive a recarregar a página.
test('a cedente liga o piloto automático e a escolha fica salva', async ({ page }) => {
  await registerCedente(page);
  await page.goto('/app/conta', { waitUntil: 'domcontentloaded' });
  await dismissOnboardingIfPresent(page);

  const card = page.getByTestId('piloto-automatico');
  const leilao = card.getByRole('switch', { name: 'Abrir o leilão sozinho' });
  await expect(leilao).toHaveAttribute('aria-checked', 'false');
  await leilao.click();
  await expect(card.getByText('Salvo.')).toBeVisible({ timeout: 10_000 });
  await card.getByLabel('Taxa máxima nos leilões automáticos').fill('2,40');
  await card.getByRole('button', { name: 'Salvar' }).click();
  await expect(card.getByText('Salvo.')).toBeVisible();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('piloto-automatico').getByRole('switch', { name: 'Abrir o leilão sozinho' })).toHaveAttribute('aria-checked', 'true', { timeout: 10_000 });
  await expect(page.getByTestId('piloto-automatico').getByLabel('Taxa máxima nos leilões automáticos')).toHaveValue('2,40');
});
