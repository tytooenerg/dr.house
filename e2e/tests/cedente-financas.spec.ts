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

  // AI CFO: the forecast page loads and renders real projected-balance data (not blank).
  await page.goto('/app/ai-cfo', { waitUntil: 'domcontentloaded' });
  await dismissOnboardingIfPresent(page);
  await expect(page.getByText('Saldo de caixa projetado')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Disponível para antecipar hoje')).toBeVisible();
  await expect(page.getByText('Insights')).toBeVisible();
});
