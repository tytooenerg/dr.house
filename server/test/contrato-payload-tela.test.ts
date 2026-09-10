import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { credenciarInvestidor } from './helpers/investidor.js';

// A família de bug que apareceu do #86 ao #93 tem uma forma recorrente: o servidor calcula e
// SERVE um dado, e a tela não o lê. Dado servido e nunca lido é o mesmo que dado ausente pra
// quem usa o painel, e nada quebra — nem o typecheck, porque a interface do client
// simplesmente não declara o campo.
//
// Foi exatamente o que aconteceu com `disputas` no painel do auditor: o bloco existia no
// servidor desde que a visão foi criada, a interface da tela não o declarava, e a lista nunca
// foi desenhada. Ninguém notou até alguém abrir a página pra outra coisa.
//
// Esta é a trava. Pra cada payload que alimenta uma tela inteira, toda chave de primeiro nível
// tem que ser MENCIONADA no arquivo da página que a consome.
//
// O que este teste é e o que não é: ele lê o texto-fonte da página e procura a chave. Isso
// prova que alguém escreveu o nome do campo ali — não prova que o campo é renderizado nem que
// está correto. É alarme de fumaça, não laudo. O que garante a renderização é o teste de
// página (client/src/pages/app/AuditorPage.test.tsx é o modelo). A vantagem deste aqui é
// custar quase nada e cobrir o payload INTEIRO, inclusive os campos que ninguém lembrou de
// testar.

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const lerPagina = (relativo: string) => fs.readFileSync(path.join(raiz, 'client', 'src', 'pages', relativo), 'utf8');

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function conta(role: string, extras: { empresarial?: boolean; credenciar?: boolean } = {}) {
  const res = await request(app)
    .post('/api/auth/register')
    // Uma conta de seguradora precisa dizer QUAL seguradora ela representa (routes/auth.ts) —
    // sem isso o cadastro é recusado e o painel responde 401.
    .send({
      nome: 'Contrato',
      email: `contrato-${unique()}@example.com`,
      password: 'senha123',
      companyName: `Contrato ${unique()}`,
      role,
      ...(role === 'seguradora' ? { insurerKey: 'too' } : {}),
    });
  const token = res.body.token as string;
  if (extras.credenciar) credenciarInvestidor(res.body.user.id);
  if (extras.empresarial) await request(app).post('/api/billing/checkout').set('Authorization', `Bearer ${token}`).send({ plan: 'empresarial' });
  return token;
}

async function adminLogin() {
  return (await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' })).body.token as string;
}

async function auditorLogin() {
  const admin = (await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' })).body.token;
  const email = `auditor-contrato-${unique()}@example.com`;
  await request(app).post('/api/admin/auditores').set('Authorization', `Bearer ${admin}`).send({ nome: 'Auditor Contrato', email, password: 'senhaforte123' });
  return (await request(app).post('/api/auth/login').send({ email, password: 'senhaforte123' })).body.token as string;
}


/**
 * Um cedente que JÁ TEM uma duplicata — e não um recém-cadastrado.
 *
 * `GET /api/minhas` de uma conta nova devolve `{ duplicatas: [] }`, e a checagem de
 * `duplicatas[].*` passa por vacuidade justamente no caso pra que ela foi criada. Uma lista
 * vazia não tem item, e um item que não existe não tem campo órfão.
 */
async function cedenteComDuplicata() {
  const token = await conta('cedente');
  for (let i = 0; i < 5; i++) {
    const res = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({ sacado: `Sacado ${unique()}`, cnpj: '44.333.222/0001-11', valor: '25.000', vencimento: '2026-12-20', seguro: false, nfAnexada: true, batchValores: [] });
    if (res.status === 200) break;
  }
  return token;
}

/**
 * Chaves que a tela legitimamente NÃO lê. Cada exceção precisa de motivo escrito: sem isso a
 * lista vira o lugar onde os achados vão morrer, que é o oposto do que este teste existe pra
 * fazer.
 */
const NAO_LIDAS: Record<string, Record<string, string>> = {
  '/api/secundario': {
    // Só o servidor decide o que entra no book; a tela desenha `market`, não este espelho.
    meusLances: 'renderizado a partir de `market`, que já traz o lance do próprio usuário embutido',
  },
  '/api/account': {},
  '/api/profile': {},
  '/api/erp': {},
  '/api/auditor/overview': {},
  '/api/dashboard': {},
  '/api/seguradora': {},
  '/api/compliance': {},
  '/api/payables': {},
  '/api/minhas': {},
  '/api/admin/preflight': {},
};


/**
 * As chaves que o payload serve, incluindo UM nível dentro de listas de objetos.
 *
 * A primeira versão desta trava olhava só o primeiro nível — e o bug que ela existe pra pegar
 * voltou a acontecer logo abaixo dele: `GET /api/minhas` serve `{ duplicatas: [...] }`, uma
 * chave só, e o campo que a tela do cedente não lia (o leilão da própria duplicata) morava
 * dentro de cada item. Olhar `duplicatas[].leilao` é o que faz a trava alcançar a forma real
 * dos payloads de lista, que é a maioria deles.
 *
 * Um nível, e não recursão completa: mais fundo que isso a lista vira ruído (objetos de
 * formatação, mapas de cor) e o teste deixa de ser barato.
 */
function chavesServidas(body: Record<string, unknown>): string[] {
  const chaves: string[] = [];
  for (const [chave, valor] of Object.entries(body)) {
    chaves.push(chave);
    const primeiro = Array.isArray(valor) ? valor[0] : null;
    if (primeiro && typeof primeiro === 'object' && !Array.isArray(primeiro)) {
      for (const sub of Object.keys(primeiro as Record<string, unknown>)) chaves.push(`${chave}[].${sub}`);
    }
  }
  return chaves;
}

interface Caso {
  nome: string;
  rota: string;
  pagina: string;
  token: () => Promise<string>;
}

const CASOS: Caso[] = [
  { nome: 'painel do auditor', rota: '/api/auditor/overview', pagina: 'app/AuditorPage.tsx', token: auditorLogin },
  { nome: 'mercado secundário', rota: '/api/secundario', pagina: 'app/SecundarioPage.tsx', token: () => conta('investidor', { credenciar: true }) },
  { nome: 'conta', rota: '/api/account', pagina: 'app/ContaPage.tsx', token: () => conta('cedente') },
  { nome: 'perfil', rota: '/api/profile', pagina: 'app/PerfilPage.tsx', token: () => conta('cedente') },
  { nome: 'integrações ERP', rota: '/api/erp', pagina: 'app/ErpPage.tsx', token: () => conta('cedente', { empresarial: true }) },
  // O dashboard muda de forma conforme o papel (lib/dashboardCore.ts monta blocos diferentes
  // pra quem emite e pra quem investe), então os dois lados entram — um só deixaria metade do
  // payload sem leitor conhecido.
  { nome: 'dashboard do investidor', rota: '/api/dashboard', pagina: 'app/DashboardPage.tsx', token: () => conta('investidor', { credenciar: true }) },
  { nome: 'dashboard do cedente', rota: '/api/dashboard', pagina: 'app/DashboardPage.tsx', token: () => conta('cedente') },
  { nome: 'painel da seguradora', rota: '/api/seguradora', pagina: 'app/SeguradoraPage.tsx', token: () => conta('seguradora') },
  { nome: 'compliance', rota: '/api/compliance', pagina: 'app/CompliancePage.tsx', token: () => conta('cedente') },
  { nome: 'contas a pagar', rota: '/api/payables', pagina: 'app/ContasPagarPage.tsx', token: () => conta('cedente') },
  // A rota que motivou a extensão desta trava pra dentro das listas: o leilão da própria
  // duplicata era servido aqui e a tela do cedente não o lia.
  { nome: 'minhas duplicatas', rota: '/api/minhas', pagina: 'app/MinhasPage.tsx', token: cedenteComDuplicata },
  { nome: 'preflight do admin', rota: '/api/admin/preflight', pagina: 'app/admin/PreflightPanel.tsx', token: adminLogin },
];

describe('contrato payload ↔ tela: nada servido pode ficar sem leitor', () => {
  it.each(CASOS.map((c) => [c.nome, c] as const))('%s', async (_nome, caso) => {
    const res = await request(app).get(caso.rota).set('Authorization', `Bearer ${await caso.token()}`);
    expect(res.status).toBe(200);

    const fonte = lerPagina(caso.pagina);
    const isentas = NAO_LIDAS[caso.rota] ?? {};
    const orfas = chavesServidas(res.body).filter((chave) => !(chave in isentas) && !fonte.includes(chave.split('[].').pop()!));

    // A mensagem tem que dizer o que fazer, não só que falhou: quem esbarrar nisto daqui a
    // seis meses precisa saber se o certo é desenhar o campo ou justificar a exceção.
    expect(
      orfas,
      `${caso.rota} serve ${orfas.length} campo(s) que ${caso.pagina} nunca menciona: ${orfas.join(', ')}. ` +
        `Ou a tela passa a lê-los, ou eles entram em NAO_LIDAS com o motivo — nunca em silêncio.`
    ).toEqual([]);
  });

  it('toda isenção declarada corresponde a um campo que o payload realmente serve', async () => {
    // Uma isenção que sobra depois que o campo sumiu do payload é lixo que enfraquece a
    // trava: ela some da revisão e passa a esconder um campo futuro de mesmo nome.
    for (const caso of CASOS) {
      const isentas = Object.keys(NAO_LIDAS[caso.rota] ?? {});
      if (isentas.length === 0) continue;
      const res = await request(app).get(caso.rota).set('Authorization', `Bearer ${await caso.token()}`);
      expect(res.status).toBe(200);
      for (const chave of isentas) {
        expect(Object.keys(res.body), `${caso.rota}: a isenção "${chave}" não corresponde a nenhum campo servido — remova-a`).toContain(chave);
      }
    }
  });
});
