import { test, expect, dismissOnboardingIfPresent } from './fixtures';

async function loginAsInvestidor(page: import('@playwright/test').Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('voce@empresa.com.br').fill('investidor@lastro.demo');
  await page.getByPlaceholder('••••••••').fill('demo1234');
  await page.locator('form').getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/app\/dashboard/);
  await dismissOnboardingIfPresent(page);
}

// Comprar deixou de ser instantâneo: o marketplace primário virou leilão de verdade, o
// investidor propõe uma taxa e o vencedor sai no fechamento (server/src/lib/auctionClose.ts).
// O que este teste cobre agora é o caminho inteiro do lance — que é o que o investidor faz.
test('investidor can browse the live marketplace and place a real bid', async ({ page }) => {
  await loginAsInvestidor(page);
  await page.goto('/app/marketplace', { waitUntil: 'domcontentloaded' });
  await dismissOnboardingIfPresent(page);

  await expect(page.getByText('Atualizações ao vivo')).toBeVisible({ timeout: 15_000 });

  const bidButton = page.getByRole('button', { name: 'Dar lance' }).first();
  await expect(bidButton).toBeVisible();
  await bidButton.click();

  // O painel do leilão abre já com a taxa de reserva preenchida — enviar como está é um
  // lance válido (é exatamente o teto que o cedente aceita).
  await expect(page.getByText(/Reserva do cedente/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Enviar lance' }).first().click();

  await expect(page.getByText('Seu lance').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: /Meus lances/ })).toBeVisible({ timeout: 10_000 });
});

test('investidor opens funding-matching explainability ("Por que essa oferta?") on a live offer', async ({ page }) => {
  await loginAsInvestidor(page);
  await page.goto('/app/marketplace', { waitUntil: 'domcontentloaded' });
  await dismissOnboardingIfPresent(page);
  await expect(page.getByText('Atualizações ao vivo')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Por que essa oferta?' }).first().click();
  await expect(page.getByText('Por que essa oferta tem esse preço')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Score de risco do sacado')).toBeVisible();
  await expect(page.getByText(/Condição de mercado/)).toBeVisible();
});
