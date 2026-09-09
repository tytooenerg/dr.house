import { test, expect, dismissOnboardingIfPresent } from './fixtures';

// O auditor era o único dos seis papéis sem teste de navegador. Isso importa mais aqui do que
// nos outros: o papel é definido por uma NEGATIVA — acesso somente-leitura —, e uma negativa
// não se prova olhando o servidor. As rotas de escrita podem estar todas fechadas e a tela
// ainda oferecer um botão que leva a um 403; ou a barra lateral pode ganhar uma aba nova que
// o papel não deveria ver. Só o navegador enxerga isso.
//
// Os testes de servidor (server/test/auditor.test.ts e auditor-balcao.test.ts) cobrem o que o
// endpoint devolve e a quem. Aqui é a outra metade: o que a pessoa vê e o que ela consegue
// clicar.

async function entrarComoAuditor(page: import('@playwright/test').Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('voce@empresa.com.br').fill('auditor@lastro.demo');
  await page.getByPlaceholder('••••••••').fill('demo1234');
  await page.locator('form').getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/app\/auditor/);
  await dismissOnboardingIfPresent(page);
}

test('demo auditor lands on the read-only panel and sees every section it is meant to see', async ({ page }) => {
  await entrarComoAuditor(page);

  // O papel cai direto no painel — não existe dashboard pra ele (DEFAULT_TAB_BY_ROLE). O
  // título aparece três vezes na tela (link do menu, breadcrumb, cabeçalho), então a asserção
  // é escopada ao conteúdo: é a PÁGINA que precisa ter carregado, não o menu em volta.
  await expect(page.getByRole('main').getByText('Painel de Auditoria')).toBeVisible();
  await expect(page.getByText(/Acesso somente-leitura/)).toBeVisible();

  // As seções que o servidor monta em lib/auditorOverview.ts, todas desenhadas. A de disputas
  // ficou meses servida e nunca renderizada porque a interface do client não declarava o
  // campo; é o motivo de ela estar afirmada aqui, e não só nos testes de servidor.
  await expect(page.getByText('Trilha de auditoria (últimos 100 eventos)')).toBeVisible();
  await expect(page.getByText('Fila de compliance pendente')).toBeVisible();
  await expect(page.getByText('Reconciliação recente')).toBeVisible();
  await expect(page.getByText('Balcão (OTC) — negociação bilateral')).toBeVisible();
  await expect(page.getByText('Disputas de aceite')).toBeVisible();

  // A cadeia de auditoria é o KPI que denuncia adulteração — tem que dizer algo, nunca ficar em branco.
  await expect(page.getByText('Cadeia de auditoria')).toBeVisible();
  await expect(page.getByText(/Íntegra|Violação em #/)).toBeVisible();
});

test('the auditor sidebar offers only the two tabs the role has, and no others', async ({ page }) => {
  await entrarComoAuditor(page);

  // ROLE_TABS.auditor === ['auditor', 'perfil']. Uma aba a mais aqui é uma rota que o papel
  // alcança sem que ninguém tenha decidido isso.
  const nav = page.getByRole('navigation');
  await expect(nav.getByRole('link', { name: 'Painel de Auditoria' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Perfil & Configurações' })).toBeVisible();

  for (const proibida of ['Marketplace', 'Emitir Duplicata', 'Minhas Duplicatas', 'Back-office', 'Mercado Secundário', 'Conta & Saldo']) {
    await expect(nav.getByRole('link', { name: proibida })).toHaveCount(0);
  }
});

test('the panel offers no way to act — the role is defined by what it cannot do', async ({ page }) => {
  await entrarComoAuditor(page);
  await expect(page.getByRole('main').getByText('Painel de Auditoria')).toBeVisible();

  // Nenhum controle de escrita na tela inteira. Não basta o servidor recusar: um botão que
  // leva a 403 é uma promessa que a interface não cumpre, e o papel diz "nenhuma ação de
  // escrita está disponível" com todas as letras no próprio subtítulo.
  const conteudo = page.locator('main');
  for (const acao of ['Aprovar', 'Rejeitar', 'Resolver', 'Marcar resolvido', 'Salvar', 'Enviar', 'Excluir']) {
    await expect(conteudo.getByRole('button', { name: acao })).toHaveCount(0);
  }
});

test('a role that is not auditor cannot reach the panel by typing the URL', async ({ page }) => {
  // O gate de rota é do <Gate tab="auditor"> no App.tsx, não do menu: esconder o link não
  // protege nada se a rota responder a quem digitar o endereço.
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('voce@empresa.com.br').fill('investidor@lastro.demo');
  await page.getByPlaceholder('••••••••').fill('demo1234');
  await page.locator('form').getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/app\/dashboard/);
  await dismissOnboardingIfPresent(page);

  await page.goto('/app/auditor', { waitUntil: 'domcontentloaded' });

  // A asserção é sobre a URL, e não sobre o texto sumir, porque as duas coisas somem por
  // motivos diferentes: o Gate REDIRECIONA pra aba padrão do papel, enquanto a rota sem gate
  // ficaria em /app/auditor mostrando o erro do servidor (a API também recusa, e a página só
  // renderiza o ErrorState). Afirmar "o título não aparece" passaria nos dois casos — foi o
  // que aconteceu na primeira versão deste teste, que passava com o Gate removido.
  await expect(page).toHaveURL(/\/app\/dashboard/);
  await expect(page.getByRole('main').getByText('Painel de Auditoria')).toHaveCount(0);
});
