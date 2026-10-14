import { test, expect } from './fixtures';

test('demo investidor can log in and reach the dashboard', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('voce@empresa.com.br').fill('investidor@lastro.demo');
  await page.getByPlaceholder('••••••••').fill('demo1234');
  await page.locator('form').getByRole('button', { name: 'Entrar' }).click();

  await expect(page).toHaveURL(/\/app\/dashboard/);
  await expect(page.getByText('Marina Costa')).toBeVisible();
});

test('rejects a wrong password with an inline error', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('voce@empresa.com.br').fill('investidor@lastro.demo');
  await page.getByPlaceholder('••••••••').fill('senha-errada');
  await page.locator('form').getByRole('button', { name: 'Entrar' }).click();

  await expect(page.getByText('E-mail ou senha incorretos.')).toBeVisible();
  await expect(page).toHaveURL('/login');
});

// Site público → empresa: o simulador mostra quanto ela recebe e o botão leva ao cadastro já
// com "Empresa (cedente)" escolhido (antes os dois botões iam para a página de contato).
test('visitante simula quanto a empresa recebe e segue para o cadastro', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: 'Simular quanto recebo' }).click();
  await page.getByRole('button', { name: 'Simular', exact: true }).click();
  const conta = page.getByTestId('demonstrativo');
  await expect(conta).toContainText('Empresa recebe', { timeout: 10_000 });
  await expect(conta).toContainText('Taxa da plataforma Lastro');
  await page.getByRole('link', { name: 'Criar conta e antecipar' }).click();
  await expect(page.getByRole('textbox', { name: 'CNPJ da empresa' })).toBeVisible({ timeout: 10_000 });
});
