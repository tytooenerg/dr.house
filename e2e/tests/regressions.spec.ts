import { test, expect, dismissOnboardingIfPresent } from './fixtures';

// Two real bugs found by driving every role through every nav page with a Playwright crawl
// and watching for console errors / uncaught page errors / failed requests:

test('cedente can open Integrações ERP without the page crashing (hooks-order regression)', async ({ page }) => {
  // ErpPage.tsx declared `whitelabelPlusError`'s useState *after* the `if (!data) return
  // <PageSkeleton />` early return. On the first render (data still null) React only sees
  // the hooks before the early return; once `/erp` resolves and the component re-renders
  // past it, that extra useState call makes React throw "Rendered more hooks than during
  // the previous render" and the page goes blank behind the ErrorBoundary.
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('voce@empresa.com.br').fill('cedente@lastro.demo');
  await page.getByPlaceholder('••••••••').fill('demo1234');
  await page.locator('form').getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/app\//, { timeout: 15_000 });
  await dismissOnboardingIfPresent(page);

  await page.goto('/app/erp', { waitUntil: 'domcontentloaded' });
  await dismissOnboardingIfPresent(page);

  // "Integrações ERP" also matches the sidebar nav button — assert on the page's own
  // subtitle instead, which only exists in the (post-crash) rendered body.
  await expect(page.getByText('Conecte seu sistema de gestão')).toBeVisible({ timeout: 10_000 });
  expect(pageErrors).toEqual([]);
});

test('investidor can edit an auto-bid rule on Automação de Lances without the page crashing', async ({ page }) => {
  // Every POST /automacao/* route replied with only the field it had just changed (e.g.
  // { autoBidRules: ... }), but AutomacaoPage.tsx does `api.post(...).then(setData)` —
  // replacing its *entire* page state with that response. Every other field went
  // `undefined`, and the next render (`data.diversification.AA`, `data.autoBidActivity.map`)
  // threw and took the whole page down behind the ErrorBoundary — reproducing exactly what
  // an investor hit typing into "Exposição máxima por sacado" or toggling "Lance automático".
  // POST /automacao/ladder (a escada de taxa por classe de rating, que substituiu o antigo
  // campo único "Taxa máxima a oferecer") é o mesmo tipo de rota nova — mesma classe de bug
  // se algum dia parar de devolver o payload inteiro, por isso testado aqui também.
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('voce@empresa.com.br').fill('investidor@lastro.demo');
  await page.getByPlaceholder('••••••••').fill('demo1234');
  await page.locator('form').getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/app\//, { timeout: 15_000 });
  await dismissOnboardingIfPresent(page);

  await page.goto('/app/automacao', { waitUntil: 'domcontentloaded' });
  await dismissOnboardingIfPresent(page);

  // Deliberately not toggling "Lance automático" itself here — the demo investidor account
  // is shared with other e2e specs running in parallel, and flipping it on would start the
  // real auto-purchase engine against the live marketplace those specs depend on. The rule
  // and diversification routes hit the identical buggy code path without that side effect.
  const exposicaoField = page.locator('div', { hasText: 'Exposição máxima por sacado (R$)' }).locator('input').first();
  await exposicaoField.fill('200.000');
  await expect(page.getByText('Algo deu errado nesta tela')).not.toBeVisible();

  await page.locator('input[type="range"]').first().fill('35');
  await expect(page.getByText('Algo deu errado nesta tela')).not.toBeVisible();

  // A escada só envia POST /automacao/ladder no blur (não a cada tecla) — ver comentário em
  // AutomacaoPage.tsx sobre por que os campos da escada não são controlados direto por `data`.
  const taxaInicialField = page.locator('div', { hasText: 'Taxa inicial (% a.m.)' }).locator('input').first();
  await taxaInicialField.fill('3,5');
  await taxaInicialField.blur();
  await expect(page.getByText('Algo deu errado nesta tela')).not.toBeVisible();

  expect(pageErrors).toEqual([]);
});
