import { test, expect, dismissOnboardingIfPresent } from './fixtures';
import type { Page } from '@playwright/test';

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerAs(page: Page, opts: { roleTitle: string; nome: string; companyName: string; email: string }) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await page.getByText(opts.roleTitle).click();
  await page.getByPlaceholder('Marina Costa').fill(opts.nome);
  await page.getByPlaceholder('Sua empresa Ltda').fill(opts.companyName);
  await page.getByPlaceholder('voce@empresa.com.br').fill(opts.email);
  await page.getByPlaceholder('mínimo 6 caracteres').fill('senha123');
  // Empresa e sacado informam o CNPJ no cadastro — o botão só libera com um CNPJ válido.
  await page.getByRole('textbox', { name: 'CNPJ da empresa' }).fill('11.444.777/0001-61');
  await expect(page.getByText(/CNPJ válido/)).toBeVisible();
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
  // Plain getByPlaceholder('50.000') is ambiguous: the AI-assistant prompt textarea's own
  // placeholder text also contains "R$ 50.000" as an example. The Field label gives this
  // input a real accessible name, so target that instead of the (non-unique) placeholder.
  await page.getByRole('textbox', { name: 'Valor (R$)' }).fill('42.000');
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
  // register form on the next goto('/login') instead of letting the sacado sign up fresh.
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page).toHaveURL('/login', { timeout: 10_000 });

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

// O sacado sem conta: a empresa informa o e-mail dele na emissão, recebe o link de aceite e o
// sacado confirma pela página pública, sem cadastro (server/src/lib/aceiteConvite.ts).
test('sacado sem conta confirma a duplicata pelo link enviado na emissão', async ({ page }) => {
  const suffix = unique();
  await registerAs(page, {
    roleTitle: 'Empresa (cedente)',
    nome: 'Cedente Link',
    companyName: `Cedente Link ${suffix}`,
    email: `cedente-link-${suffix}@example.com`,
  });
  await expect(page).toHaveURL(/\/app\//, { timeout: 15_000 });
  await page.goto('/app/emitir', { waitUntil: 'domcontentloaded' });
  await dismissOnboardingIfPresent(page);

  await page.getByPlaceholder('ex: Grupo Atlas Varejo').fill(`Cliente Sem Conta ${suffix}`);
  await page.getByRole('textbox', { name: 'CNPJ do sacado' }).fill('11.222.333/0001-81');
  await page.getByRole('textbox', { name: 'E-mail do sacado (opcional)' }).fill('financeiro@cliente.com.br');
  await page.getByRole('textbox', { name: 'Valor (R$)' }).fill('15.000');
  await page.locator('input[type="date"]').fill('2026-12-31');

  for (let attempt = 0; attempt < 5; attempt++) {
    await page.getByRole('button', { name: /Emitir e registrar duplicata/ }).click();
    const success = page.getByText('Duplicata registrada com sucesso');
    const failure = page.getByText(/Falha ao registrar na CERC/);
    await Promise.race([success.waitFor({ timeout: 8000 }), failure.waitFor({ timeout: 8000 })]).catch(() => {});
    if (await success.isVisible().catch(() => false)) break;
  }
  await expect(page.getByText('Duplicata registrada com sucesso')).toBeVisible();

  // O atalho do WhatsApp carrega a mensagem com o link — é o que a empresa manda ao sacado.
  const href = await page.getByTestId('convite-emissao').getByRole('link', { name: 'Enviar pelo meu WhatsApp' }).getAttribute('href');
  const mensagem = decodeURIComponent(new URL(href!).searchParams.get('text')!);
  const link = mensagem.match(/https?:\/\/\S+\/aceite\/[A-Za-z0-9_-]+/)![0];

  await page.goto(new URL(link).pathname, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Confirme esta duplicata')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Confirmo' }).click();
  await page.getByRole('textbox', { name: /CNPJ da sua empresa/ }).fill('11.222.333/0001-81');
  await page.getByRole('textbox', { name: 'Seu nome' }).fill('Ana Souza');
  await page.getByRole('textbox', { name: 'Seu cargo' }).fill('Financeiro');
  await page.getByRole('button', { name: 'Confirmar a duplicata' }).click();
  await expect(page.getByText('Duplicata confirmada')).toBeVisible({ timeout: 10_000 });
});
