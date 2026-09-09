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

// O balcão entrou no #91 sem cobertura de e2e. Este teste guarda o que só o navegador vê: o
// card existe, está na página do secundário e o formulário de proposta responde — é isso que
// quebra em silêncio quando a página é refatorada.
//
// A mecânica da negociação (rodadas, prazo, privacidade, liquidação) NÃO está aqui de
// propósito: ela exige duas contas de investidor credenciadas, e o credenciamento (KYB) é
// ato do admin. Isso é coberto pelos testes de servidor, que constroem as duas pontas.
test('demo investidor sees the Balcão (OTC) desk and can compose a directed proposal', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('voce@empresa.com.br').fill('investidor@lastro.demo');
  await page.getByPlaceholder('••••••••').fill('demo1234');
  await page.locator('form').getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/app\/dashboard/);
  await dismissOnboardingIfPresent(page);

  await page.goto('/app/secundario', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Balcão (OTC)')).toBeVisible({ timeout: 10_000 });
  // A promessa que distingue o balcão do book, na própria tela.
  await expect(page.getByText(/mesmo que ela não esteja anunciada no book/)).toBeVisible();

  const duplicata = page.getByLabel('Duplicata da proposta de balcão');
  const valor = page.getByLabel('Valor da sua proposta');
  await expect(duplicata).toBeVisible();

  // O botão de abrir só habilita com duplicata E valor — proposta sem preço não é proposta.
  const abrir = page.getByRole('button', { name: 'Enviar proposta' });
  await expect(abrir).toBeDisabled();
  await duplicata.fill('DUP-2026-0842');
  await expect(abrir).toBeDisabled();
  await valor.fill('25.000');
  await expect(abrir).toBeEnabled();
});
