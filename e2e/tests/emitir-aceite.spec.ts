import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function dismissOnboardingIfPresent(page: Page) {
  const skipOnboarding = page.getByRole('button', { name: 'Pular' });
  if (await skipOnboarding.isVisible({ timeout: 15_000 }).catch(() => false)) {
    await skipOnboarding.click();
    await expect(skipOnboarding).toBeHidden({ timeout: 5000 }).catch(() => {});
  }
}

async function registerAs(page: Page, opts: { roleTitle: string; nome: string; companyName: string; email: string }) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await page.getByText(opts.roleTitle).click();
  await page.getByPlaceholder('Marina Costa').fill(opts.nome);
  await page.getByPlaceholder('Sua empresa Ltda').fill(opts.companyName);
  await page.getByPlaceholder('voce@empresa.com.br').fill(opts.email);
  await page.getByPlaceholder('mínimo 6 caracteres').fill('senha123');
  await page.getByRole('button', { name: 'Criar conta e entrar' }).click();
  await dismissOnboardingIfPresent(page);
}

test('a cedente can emit a duplicata and the matching sacado can confirm it', async ({ page }) => {
  const suffix = unique();
  const sacadoCompany = `Sacado Teste ${suffix}`;

  // 1. Cedente registers and emits a duplicata against the sacado company below.
  await registerAs(page, {
    roleTitle: 'Empresa (cedente)',
    nome: 'Cedente Teste',
    companyName: `Cedente Teste ${suffix}`,
    email: `cedente-${suffix}@example.com`,
  });
  await expect(page).toHaveURL(/\/app\//, { timeout: 15_000 });
  await page.goto('/app/emitir', { waitUntil: 'domcontentloaded' });
  await dismissOnboardingIfPresent(page);

  await page.getByPlaceholder('ex: Grupo Atlas Varejo').fill(sacadoCompany);
  await page.getByPlaceholder('50.000').fill('42.000');
  await page.locator('input[type="date"]').fill('2026-12-31');

  // The submit endpoint randomly simulates a CERC outage ~12% of the time — retry through it.
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.getByRole('button', { name: /Emitir e registrar duplicata/ }).click();
    const success = page.getByText('Duplicata registrada com sucesso');
    const failure = page.getByText(/Falha ao registrar na CERC/);
    await Promise.race([success.waitFor({ timeout: 8000 }), failure.waitFor({ timeout: 8000 })]).catch(() => {});
    if (await success.isVisible().catch(() => false)) break;
  }
  await expect(page.getByText('Duplicata registrada com sucesso')).toBeVisible();

  // Log out — otherwise the still-valid cedente session redirects straight past the
  // register form on the next goto('/') instead of letting the sacado sign up fresh.
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page).toHaveURL('/', { timeout: 10_000 });

  // 2. The sacado (matched by company name) registers and confirms the duplicata.
  await registerAs(page, {
    roleTitle: 'Empresa (sacado)',
    nome: 'Sacado Teste',
    companyName: sacadoCompany,
    email: `sacado-${suffix}@example.com`,
  });
  await expect(page).toHaveURL(/\/app\//, { timeout: 15_000 });
  await page.goto('/app/sacado', { waitUntil: 'domcontentloaded' });
  await dismissOnboardingIfPresent(page);

  await expect(page.getByText(`${sacadoCompany} (sacado)`)).toBeVisible();
  const confirmButton = page.getByRole('button', { name: 'Confirmar recebimento' }).first();
  await expect(confirmButton).toBeVisible();
  await confirmButton.click();
  await expect(page.getByText('Aceita pelo sacado').first()).toBeVisible();
});
