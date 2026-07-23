import { test, expect } from './fixtures';

test('demo investidor can log in and reach the dashboard', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('voce@empresa.com.br').fill('investidor@lastro.demo');
  await page.getByPlaceholder('••••••••').fill('demo1234');
  await page.locator('form').getByRole('button', { name: 'Entrar' }).click();

  await expect(page).toHaveURL(/\/app\/dashboard/);
  await expect(page.getByText('Marina Costa')).toBeVisible();
});

test('rejects a wrong password with an inline error', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('voce@empresa.com.br').fill('investidor@lastro.demo');
  await page.getByPlaceholder('••••••••').fill('senha-errada');
  await page.locator('form').getByRole('button', { name: 'Entrar' }).click();

  await expect(page.getByText('E-mail ou senha incorretos.')).toBeVisible();
  await expect(page).toHaveURL('/');
});
