#!/usr/bin/env node
// Uma operação de duplicata inteira, do cadastro ao vencimento, contra um servidor de
// PRODUÇÃO rodando de verdade. Sem supertest, sem banco em memória, sem helper de teste
// fechando leilão: HTTP pela rede, arquivo SQLite em disco, e o job de 30 segundos do
// próprio processo adjudicando o leilão.
//
// Por que isto existe, se já há server/test/full-lifecycle-all-roles.test.ts encadeando os
// seis papéis: aquele teste roda o `app` importado in-process, com DB_PATH=':memory:', e
// fecha o leilão chamando fecharLeiloes() — o helper que invoca closeDueAuctions() com um
// "agora" adiantado em 365 dias. Os 19 arquivos que fecham leilão fazem todos assim.
//
// Consequência: NADA no repositório prova que o setInterval de 30s existe e adjudica.
// Se startAuctionCloseJob() sumisse do index.ts, a suíte inteira continuaria verde e
// nenhum leilão fecharia em produção. O mesmo vale pro banco em arquivo — server e e2e
// usam ':memory:', então WAL, migrações num arquivo novo e escrita concorrente nunca são
// exercitados por nada. É essa metade que este roteiro cobre.
//
// A ÚNICA coisa simulada aqui é a passagem do tempo (avancarRelogio, abaixo): um leilão
// dura 6h e uma duplicata vence em 90 dias, e não dá pra esperar. Todo o resto — cada
// transição de estado, cada centavo — é o servidor real fazendo o que faria.
//
// Uso:
//   1. npm run build
//   2. DB_PATH=/caminho/operacao.db JWT_SECRET=... PORT=4100 \
//        CORS_ORIGINS=http://localhost:4100 NODE_ENV=production node server/dist/index.js
//   3. ADMIN_EMAIL=... ADMIN_PASSWORD=... DB_PATH=/caminho/operacao.db \
//        npm run create-admin --workspace=server
//   4. npm run operacao:real -- --url http://localhost:4100 --db /caminho/operacao.db \
//        --admin-email ... --admin-senha ...
//
// Flags:
//   --sem-relogio   não adianta o close_at do leilão. É o controle negativo: o leilão tem
//                   que continuar aberto e o passo 8 tem que FALHAR por timeout. Sem rodar
//                   isso pelo menos uma vez, "esperei e fechou" passaria mesmo que algo
//                   diferente do job estivesse fechando.

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opcao = (flag, padrao) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : padrao;
};
const tem = (flag) => args.includes(flag);

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = opcao('--url', process.env.OPERACAO_URL || 'http://localhost:4100');
const DB = opcao('--db', process.env.DB_PATH || '');
const ADMIN_EMAIL = opcao('--admin-email', process.env.ADMIN_EMAIL || '');
const ADMIN_SENHA = opcao('--admin-senha', process.env.ADMIN_PASSWORD || '');
const SEM_RELOGIO = tem('--sem-relogio');

const VALOR_FACE = 50_000;
const DEPOSITO = 120_000;
const RESERVA_AM = 3.0; // pior deságio que o cedente aceita
const TAXA_A = 2.5; // lance do investidor A
const TAXA_B = 1.9; // lance do investidor B — menor deságio, tem que vencer
const OTC_PROPOSTA = 47_000;
const OTC_CONTRA = 48_500;

// ---------------------------------------------------------------- infraestrutura mínima

let passo = 0;
const falhas = [];

function secao(titulo) {
  passo++;
  console.log(`\n\x1b[1m${String(passo).padStart(2, '0')}. ${titulo}\x1b[0m`);
}

function conferir(descricao, ok, detalhe = '') {
  if (ok) console.log(`   \x1b[32m✓\x1b[0m ${descricao}${detalhe ? ` — ${detalhe}` : ''}`);
  else {
    console.log(`   \x1b[31m✗\x1b[0m ${descricao}${detalhe ? ` — ${detalhe}` : ''}`);
    falhas.push(`${descricao}${detalhe ? ` — ${detalhe}` : ''}`);
  }
  return ok;
}

function abortar(msg) {
  console.error(`\n\x1b[31mOperação interrompida:\x1b[0m ${msg}`);
  process.exit(1);
}

async function chamar(metodo, rota, { token, body } = {}) {
  const res = await fetch(`${BASE}/api${rota}`, {
    method: metodo,
    headers: {
      'content-type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (res.status === 429) abortar('429 do rate limiter de autenticação (20 req / 15 min por IP). Reinicie o servidor — o contador é em memória — e rode de novo.');
  return { status: res.status, body: json ?? {} };
}

const get = (rota, token) => chamar('GET', rota, { token });
const post = (rota, token, body) => chamar('POST', rota, { token, body });

/**
 * "R$ 1.234" -> 1234 · "-R$ 1.234,56" -> -1234.56
 *
 * Toda a plataforma formata dinheiro com `maximumFractionDigits: 0` (lib/format.ts), então
 * o normal é a string NÃO ter centavos — e um parser ingênuo que só tira os não-dígitos lê
 * "R$ 47.182" como R$ 471,82. Foi o primeiro erro deste roteiro, e vale registrar: quem lê
 * a API pela tela está lendo números arredondados ao real, sempre.
 */
function reais(fmt) {
  if (typeof fmt !== 'string') return NaN;
  const negativo = fmt.trimStart().startsWith('-') || fmt.includes('-R$');
  const limpo = fmt.replace(/[^\d,]/g, '');
  if (!limpo) return NaN;
  const [inteiro, centavos = '0'] = limpo.split(',');
  const n = Number(inteiro) + Number(centavos.padEnd(2, '0')) / 100;
  return negativo ? -n : n;
}

const brl = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A única coisa simulada no roteiro inteiro: o relógio.
 *
 * Abre o MESMO arquivo SQLite que o servidor no ar está usando — journal_mode=WAL está
 * ligado (server/src/db/index.ts), então um segundo processo escreve sem brigar com ele — e
 * recua um carimbo de tempo para o passado. Nenhum estado é alterado: quem transiciona a
 * duplicata continua sendo o job de 30s do servidor, ou o endpoint do sacado. É o
 * equivalente honesto de esperar seis horas / noventa dias.
 */
function comOBanco(fn) {
  if (!DB) abortar('--db (ou DB_PATH) é obrigatório: o roteiro precisa do arquivo do banco pra adiantar o relógio.');
  const require = createRequire(pathToFileURL(path.join(RAIZ, 'server', 'package.json')));
  const Database = require('better-sqlite3');
  const banco = new Database(DB);
  try {
    return fn(banco);
  } finally {
    banco.close();
  }
}

function avancarRelogio(sql, params) {
  return comOBanco((banco) => banco.prepare(sql).run(...params));
}

/**
 * Os lançamentos EXATOS de uma conta sobre esta duplicata, direto da tabela `ledger`.
 *
 * Leitura, não simulação: a conferência de caixa precisa dos números como o servidor os
 * gravou (REAL, com centavos), e a API só devolve a versão arredondada ao real. Fechar a
 * aritmética da cadeia sobre valores arredondados daria uma diferença de alguns reais que
 * não é achado nenhum — é a formatação. A comparação entre os dois vem logo depois.
 */
function ledgerExato(userId, duplicataId) {
  return comOBanco((banco) =>
    banco.prepare('SELECT descricao, valor FROM ledger WHERE user_id = ? AND descricao LIKE ? ORDER BY id').all(userId, `%${duplicataId}%`)
  );
}

const unico = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

async function registrar(role, companyName, extra = {}) {
  const email = `${unico(role)}@operacao.test`;
  const res = await post('/auth/register', null, { nome: `Operação ${role}`, email, password: 'operacao-real-2026', companyName, role, ...extra });
  if (res.status !== 200 && res.status !== 201) abortar(`registro de ${role} falhou (${res.status}): ${JSON.stringify(res.body)}`);
  return { email, token: res.body.token, userId: res.body.user.id, companyName };
}

async function login(email, senha) {
  const res = await post('/auth/login', null, { email, password: senha });
  if (res.status !== 200) abortar(`login de ${email} falhou (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.token;
}

async function depositar(conta, valor) {
  const cobranca = await post('/account/deposit', conta.token, { valor });
  if (cobranca.status !== 200) abortar(`cobrança Pix de ${conta.companyName} falhou (${cobranca.status})`);
  const confirmado = await post(`/account/deposit/${cobranca.body.txid}/confirm-simulado`, conta.token);
  if (confirmado.status !== 200) abortar(`confirmação do depósito de ${conta.companyName} falhou (${confirmado.status})`);
  return { simulado: cobranca.body.simulado, saldoFmt: confirmado.body.saldoDisponivelFmt };
}

async function saldo(token) {
  const res = await get('/account', token);
  return { saldo: reais(res.body.saldoDisponivelFmt), extrato: res.body.extrato ?? [] };
}

function movimentos(extrato, duplicataId) {
  return extrato.filter((e) => e.descricao.includes(duplicataId));
}

// ------------------------------------------------------------------------- a operação

async function main() {
  console.log(`\x1b[1mOperação real — ${BASE}\x1b[0m`);
  console.log(`banco: ${DB || '(não informado)'}${SEM_RELOGIO ? '   \x1b[33m[--sem-relogio: controle negativo]\x1b[0m' : ''}`);

  if (!ADMIN_EMAIL || !ADMIN_SENHA) abortar('--admin-email e --admin-senha são obrigatórios (a conta criada por `npm run create-admin`).');

  // 1 ------------------------------------------------------------------------------
  secao('Servidor no ar');
  const saude = await get('/health');
  if (!conferir('GET /api/health responde', saude.status === 200, JSON.stringify(saude.body))) abortar('servidor não respondeu.');

  // 2 ------------------------------------------------------------------------------
  secao('Cadastro — os cinco papéis que se auto-cadastram, pela tela de registro');
  const sacadoEmpresa = unico('Atlas Varejo');
  const cedente = await registrar('cedente', unico('Fornecedor Lima'));
  const sacado = await registrar('sacado', sacadoEmpresa);
  const invA = await registrar('investidor', unico('Fundo Aurora'));
  const invB = await registrar('investidor', unico('Fundo Bandeirantes'));
  const seguradora = await registrar('seguradora', 'Too Seguros', { insurerKey: 'too' });
  conferir('cinco contas criadas', true, `${cedente.companyName} · ${sacado.companyName} · ${invA.companyName} · ${invB.companyName} · seguradora`);
  const adminToken = await login(ADMIN_EMAIL, ADMIN_SENHA);
  conferir('admin autenticado (conta de bootstrap, não do seed de demo)', !!adminToken, ADMIN_EMAIL);

  // 3 ------------------------------------------------------------------------------
  secao('Capital — investidores depositam de verdade (Pix, cobrança + confirmação)');
  const depA = await depositar(invA, DEPOSITO);
  const depB = await depositar(invB, DEPOSITO);
  conferir('investidor A financiou a conta', reais(depA.saldoFmt) === DEPOSITO, `saldo ${depA.saldoFmt}${depA.simulado ? ' (rail simulado, PIX_PSP_* não configurado)' : ''}`);
  conferir('investidor B financiou a conta', reais(depB.saldoFmt) === DEPOSITO, `saldo ${depB.saldoFmt}`);

  // 4 ------------------------------------------------------------------------------
  secao('KYB — o admin credencia os dois investidores');
  for (const [nome, inv] of [['A', invA], ['B', invB]]) {
    const kyb = await post('/auth/kyb', inv.token, { cnpj: '12.345.678/0001-90', tipo: 'fidc', pl: '2.000.000' });
    conferir(`investidor ${nome} enviou KYB`, kyb.status === 200, `status ${kyb.status}`);
    const aprova = await post(`/admin/kyb/${inv.userId}/approve`, adminToken);
    conferir(`admin aprovou o KYB do investidor ${nome}`, aprova.status === 200, `status ${aprova.status}`);
  }

  // 5 ------------------------------------------------------------------------------
  secao('Emissão — o cedente emite a duplicata');
  const vencimento = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const emissao = await post('/emitir/submit', cedente.token, {
    sacado: sacadoEmpresa,
    cnpj: '44.333.222/0001-11',
    valor: String(VALOR_FACE),
    vencimento,
    seguro: false,
    nfAnexada: true,
    batchValores: [],
  });
  if (emissao.status !== 200) abortar(`emissão falhou (${emissao.status}): ${JSON.stringify(emissao.body)}`);
  const duplicataId = emissao.body.duplicataId;
  // Trava contra o erro mais fácil de cometer aqui: apontar --db pra um arquivo e o servidor
  // estar rodando sobre outro. Sem isto, o roteiro adianta o relógio de um banco que ninguém
  // lê, o leilão não fecha, e a mensagem de erro culpa o job.
  const noBanco = comOBanco((banco) => banco.prepare('SELECT id FROM duplicatas WHERE id = ?').get(duplicataId));
  if (!noBanco) abortar(`a duplicata ${duplicataId} não está em ${DB} — o servidor em ${BASE} está usando outro banco. Confira o DB_PATH com que ele subiu.`);
  conferir('duplicata emitida', !!duplicataId, `${duplicataId} · face ${brl(VALOR_FACE)} · vence ${vencimento}`);

  let minhas = await get('/minhas', cedente.token);
  let dup = minhas.body.duplicatas.find((d) => d.id === duplicataId);
  // GET /minhas devolve o RÓTULO do status, não a chave (routes/minhas.ts's view()) — é o que
  // a tela do cedente recebe, então é por ele que o roteiro se guia.
  if (dup?.status === 'Em revisão de compliance') {
    const decide = await post(`/admin/compliance-queue/${duplicataId}/decidir`, adminToken, { decision: 'liberado', note: 'Revisão manual da operação real.' });
    conferir('admin liberou a duplicata na fila de compliance', decide.status === 200, `status ${decide.status}`);
    minhas = await get('/minhas', cedente.token);
    dup = minhas.body.duplicatas.find((d) => d.id === duplicataId);
  }
  conferir('duplicata aprovada e pronta pra negociar', dup?.status === 'Aprovada', `status "${dup?.status}"`);

  // 6 ------------------------------------------------------------------------------
  secao('Aceite — o sacado confirma pela própria conta (sem atalho por SQL)');
  const aceites = await get('/aceites', sacado.token);
  const aceite = (aceites.body.aceites ?? []).find((a) => a.duplicataId === duplicataId);
  if (!aceite) abortar('o sacado não enxergou a duplicata na fila de aceites.');
  const confirma = await post(`/aceites/${aceite.id}/status`, sacado.token, { status: 'aceita' });
  conferir('sacado confirmou o aceite', confirma.status === 200, `POST /aceites/${aceite.id}/status → ${confirma.status}`);

  // 7 ------------------------------------------------------------------------------
  secao('Seguro — o investidor A contrata cobertura antes da venda');
  const seguradoraToken = await login(seguradora.email, 'operacao-real-2026');
  const segAntes = await saldo(seguradoraToken);
  const seguro = await post(`/market/${duplicataId}/insure`, invA.token, { key: 'too' });
  conferir('apólice contratada pelo investidor A', seguro.status === 200, `status ${seguro.status}`);
  const segDepois = await saldo(seguradoraToken);
  const premio = segDepois.saldo - segAntes.saldo;
  if (premio === 0) abortar('a conta de seguradora recém-criada não recebeu o prêmio — já existe outra conta com a mesma insurerKey neste banco (settleInsurance credita a primeira). Rode sobre um banco novo.');
  conferir('prêmio caiu no extrato da seguradora', premio > 0 && movimentos(segDepois.extrato, duplicataId).length === 1, `${brl(premio)}`);

  // 8 ------------------------------------------------------------------------------
  secao('Leilão — o cedente abre e dois investidores dão lances de verdade');
  const abre = await post(`/minhas/${duplicataId}/leilao`, cedente.token, { taxaMaxima: RESERVA_AM });
  conferir('leilão aberto', abre.status === 200, `reserva ${RESERVA_AM}% a.m.`);
  const lanceA = await post(`/market/${duplicataId}/lance`, invA.token, { taxaAm: TAXA_A });
  const lanceB = await post(`/market/${duplicataId}/lance`, invB.token, { taxaAm: TAXA_B });
  conferir(`lance do investidor A a ${TAXA_A}% a.m.`, lanceA.status === 200, lanceA.body.precoFmt ?? JSON.stringify(lanceA.body));
  conferir(`lance do investidor B a ${TAXA_B}% a.m.`, lanceB.status === 200, lanceB.body.precoFmt ?? JSON.stringify(lanceB.body));
  const precoLeilao = reais(lanceB.body.precoFmt);

  // 9 ------------------------------------------------------------------------------
  secao('Fechamento — quem adjudica é o job de 30s do servidor, não este roteiro');
  if (SEM_RELOGIO) {
    console.log('   \x1b[33m•\x1b[0m --sem-relogio: o close_at fica a 6h de distância. O esperado é o leilão NÃO fechar.');
  } else {
    const r = avancarRelogio("UPDATE duplicatas SET close_at = datetime('now', '-1 minute') WHERE id = ?", [duplicataId]);
    conferir('close_at recuado pro passado (a única coisa simulada)', r.changes === 1, `${r.changes} linha`);
  }
  const limite = Date.now() + 75_000;
  let fechou = false;
  let esperou = 0;
  while (Date.now() < limite) {
    await dormir(3000);
    esperou += 3;
    const m = await get('/minhas', cedente.token);
    const atual = m.body.duplicatas.find((d) => d.id === duplicataId);
    if (atual?.status === 'Vendida') {
      fechou = true;
      break;
    }
    process.stdout.write(`   … esperando o job (${esperou}s)\r`);
  }
  process.stdout.write(' '.repeat(40) + '\r');
  if (SEM_RELOGIO) {
    conferir('controle negativo: o leilão NÃO fechou sozinho', !fechou, fechou ? 'fechou sem o prazo vencer — algo além do job está adjudicando' : `${esperou}s de espera, leilão segue aberto`);
    console.log('\n\x1b[33mControle negativo concluído — pare aqui.\x1b[0m');
    return falhas.length;
  }
  if (!conferir('o job fechou o leilão sozinho', fechou, `${esperou}s de espera (o setInterval é de 30s)`)) abortar('o leilão não fechou — sem isso o resto da operação não acontece.');

  const posB = await get('/secundario', invB.token);
  const posicaoB = (posB.body.minhasPosicoes ?? []).find((p) => p.duplicataId === duplicataId);
  conferir('o menor deságio venceu — a posição é do investidor B', !!posicaoB, `${TAXA_B}% a.m. contra ${TAXA_A}% de A`);
  conferir('investidor A não levou nada', !(await get('/secundario', invA.token)).body.minhasPosicoes?.some((p) => p.duplicataId === duplicataId));

  const cedenteApos = await saldo(cedente.token);
  const creditoCedente = movimentos(cedenteApos.extrato, duplicataId).filter((e) => e.isPositive);
  const recebidoCedente = creditoCedente.reduce((s, e) => s + reais(e.valorFmt), 0);
  conferir('cedente recebeu a antecipação', recebidoCedente > 0, `${brl(recebidoCedente)} sobre preço de leilão ${brl(precoLeilao)} (taxa da plataforma: ${brl(precoLeilao - recebidoCedente)})`);

  const bApos = await saldo(invB.token);
  const debitoB = movimentos(bApos.extrato, duplicataId).filter((e) => !e.isPositive).reduce((s, e) => s + reais(e.valorFmt), 0);
  conferir('investidor B pagou exatamente o preço do próprio lance', Math.abs(debitoB) === precoLeilao, `${brl(Math.abs(debitoB))}`);

  // 10 -----------------------------------------------------------------------------
  secao('Balcão (OTC) — A negocia a posição de B, com contraproposta');
  const abreOtc = await post('/secundario/otc', invA.token, { duplicataId, valor: String(OTC_PROPOSTA), nota: 'Proposta da operação real.' });
  conferir('A abriu proposta dirigida a B', abreOtc.status === 200, `${brl(OTC_PROPOSTA)}`);
  const negId = abreOtc.body.negociacaoId;
  const contra = await post(`/secundario/otc/${negId}/contraproposta`, invB.token, { valor: String(OTC_CONTRA), nota: 'Abaixo disso não solto.' });
  conferir('B contrapropôs', contra.status === 200, `${brl(OTC_CONTRA)}`);
  const aceita = await post(`/secundario/otc/${negId}/aceitar`, invA.token);
  conferir('A aceitou — negócio fechado fora do book', aceita.status === 200, `status ${aceita.status}`);

  const posA = await get('/secundario', invA.token);
  conferir('a posição passou pro investidor A', (posA.body.minhasPosicoes ?? []).some((p) => p.duplicataId === duplicataId));
  conferir('e saiu do investidor B', !(await get('/secundario', invB.token)).body.minhasPosicoes?.some((p) => p.duplicataId === duplicataId));

  // 11 -----------------------------------------------------------------------------
  secao('Vencimento — o sacado paga, e quem recebe é o credor ATUAL');
  const r2 = avancarRelogio("UPDATE duplicatas SET vencimento = date('now', '-1 day') WHERE id = ?", [duplicataId]);
  conferir('vencimento recuado pro passado (a única coisa simulada)', r2.changes === 1);
  const pagamento = await post(`/aceites/${aceite.id}/pagamento`, sacado.token);
  conferir('sacado reportou o pagamento', pagamento.status === 200, `status ${pagamento.status}`);

  const aFinal = await saldo(invA.token);
  const creditoVencimento = movimentos(aFinal.extrato, duplicataId).find((e) => e.isPositive && /vencimento/i.test(e.descricao));
  conferir('o valor de face caiu na conta de A (não de B, não do cedente)', !!creditoVencimento && reais(creditoVencimento.valorFmt) === VALOR_FACE, creditoVencimento?.valorFmt ?? 'nenhum crédito de vencimento');
  const bFinal = await saldo(invB.token);
  conferir('B não recebeu nada no vencimento — vendeu a posição antes', !movimentos(bFinal.extrato, duplicataId).some((e) => e.isPositive && /vencimento/i.test(e.descricao)));

  // 12 -----------------------------------------------------------------------------
  secao('Caixa — a aritmética da cadeia fecha, conta por conta');
  // Sobre o ledger EXATO, não sobre a tela: fmtBRL arredonda ao real (maximumFractionDigits: 0),
  // e uma soma de cinco parcelas arredondadas erra por alguns reais sem que nada esteja errado.
  const exatoA = ledgerExato(invA.userId, duplicataId);
  const exatoB = ledgerExato(invB.userId, duplicataId);
  const exatoCedente = ledgerExato(cedente.userId, duplicataId);
  const exatoSeguradora = ledgerExato(seguradora.userId, duplicataId);
  const exatoSacado = ledgerExato(sacado.userId, duplicataId);
  const soma = (linhas) => linhas.reduce((t, l) => t + l.valor, 0);

  const pnlA = soma(exatoA);
  const pnlB = soma(exatoB);
  const liquidoCedente = soma(exatoCedente);
  const premioExato = soma(exatoSeguradora);
  const precoLeilaoExato = -soma(exatoB.filter((l) => l.valor < 0));

  for (const [nome, linhas] of [['cedente', exatoCedente], ['investidor B', exatoB], ['investidor A', exatoA], ['seguradora', exatoSeguradora], ['sacado', exatoSacado]]) {
    console.log(`   \x1b[1m${nome}\x1b[0m ${brl(soma(linhas))}`);
    for (const l of linhas) console.log(`      ${l.valor >= 0 ? '+' : '−'}${brl(Math.abs(l.valor)).padStart(12)}  ${l.descricao}`);
  }

  // A economia real da cadeia, como o servidor a implementa (lib/settlement.ts):
  //  · taxa primária  = 0,35% sobre o VALOR DE FACE, descontada do cedente — deliberado e
  //    comentado na fonte: a taxa é sobre o tamanho do recebível antecipado, não sobre o que
  //    o investidor pagou por ele;
  //  · taxa secundária = 0,35% sobre o PREÇO DE VENDA, descontada de quem vende no balcão;
  //  · comissão de seguro = 18% do prêmio, retida sobre o repasse à seguradora.
  // A receita da plataforma é LIDA das tabelas de receita, não assumida: se um centavo de
  // taxa fosse cobrado e não registrado (ou registrado e não cobrado), a identidade quebra.
  const receitaTaxas = comOBanco((banco) => banco.prepare('SELECT origem, fee_valor FROM platform_fee_events WHERE duplicata_id = ?').all(duplicataId));
  const comissaoSeguro = comOBanco((banco) => banco.prepare('SELECT comissao_lastro FROM insurance_settlements WHERE duplicata_id = ?').all(duplicataId));
  const taxaPrimaria = receitaTaxas.filter((r) => r.origem === 'compra').reduce((t, r) => t + r.fee_valor, 0);
  const taxaSecundaria = receitaTaxas.filter((r) => r.origem === 'revenda').reduce((t, r) => t + r.fee_valor, 0);
  const comissao = comissaoSeguro.reduce((t, r) => t + r.comissao_lastro, 0);
  const receitaPlataforma = taxaPrimaria + taxaSecundaria + comissao;
  console.log(`   \x1b[1mplataforma\x1b[0m ${brl(receitaPlataforma)}`);
  console.log(`      + ${brl(taxaPrimaria)}  taxa primária (0,35% do face)`);
  console.log(`      + ${brl(taxaSecundaria)}  taxa secundária (0,35% do preço do balcão)`);
  console.log(`      + ${brl(comissao)}  comissão sobre o prêmio de seguro (18%)`);

  const premioPagoPorA = -soma(exatoA.filter((l) => /Prêmio de seguro/.test(l.descricao)));
  const recebidoPorBNoBalcao = soma(exatoB.filter((l) => l.valor > 0));

  conferir('taxa primária foi cobrada sobre o face, não sobre o preço do lance', Math.abs(taxaPrimaria - VALOR_FACE * 0.0035) < 0.005, `${brl(taxaPrimaria)} = 0,35% × ${brl(VALOR_FACE)}`);
  conferir('taxa secundária foi cobrada sobre o preço negociado no balcão', Math.abs(taxaSecundaria - OTC_CONTRA * 0.0035) < 0.005, `${brl(taxaSecundaria)} = 0,35% × ${brl(OTC_CONTRA)}`);
  conferir('a seguradora recebeu o prêmio líquido da comissão', Math.abs(premioExato - (premioPagoPorA - comissao)) < 0.005, `${brl(premioExato)} = ${brl(premioPagoPorA)} − ${brl(comissao)}`);
  conferir('P&L de B = o que recebeu no balcão − o que pagou no leilão', Math.abs(pnlB - (recebidoPorBNoBalcao - precoLeilaoExato)) < 0.005, `${brl(pnlB)} = ${brl(recebidoPorBNoBalcao)} − ${brl(precoLeilaoExato)}`);
  conferir('P&L de A = face − preço do balcão − prêmio pago', Math.abs(pnlA - (VALOR_FACE - OTC_CONTRA - premioPagoPorA)) < 0.005, `${brl(pnlA)} = ${brl(VALOR_FACE)} − ${brl(OTC_CONTRA)} − ${brl(premioPagoPorA)}`);
  conferir(
    'nada evaporou: o face pago = cedente + A + B + seguradora + receita da plataforma',
    Math.abs(VALOR_FACE - (liquidoCedente + pnlA + pnlB + premioExato + receitaPlataforma)) < 0.005,
    `${brl(VALOR_FACE)} = ${brl(liquidoCedente)} + ${brl(pnlA)} + ${brl(pnlB)} + ${brl(premioExato)} + ${brl(receitaPlataforma)}`
  );
  conferir(
    'o sacado é o único que só paga — e nada sobrou no ledger dele',
    exatoSacado.length === 0,
    exatoSacado.length === 0 ? 'nenhum lançamento (o sacado paga por fora da plataforma; o crédito entra na conta do credor)' : `${exatoSacado.length} lançamento(s) inesperado(s)`
  );

  // A outra metade: o que a API mostra tem que ser esse mesmo número, arredondado — não um
  // número diferente. É onde um bug de view-model apareceria.
  const arredondado = (n) => Math.round(n);
  conferir(
    'o extrato que a API serve bate com o ledger, a menos do arredondamento ao real',
    movimentos(aFinal.extrato, duplicataId).map((e) => reais(e.valorFmt)).reduce((t, v) => t + v, 0) === arredondado(pnlA),
    `tela ${brl(movimentos(aFinal.extrato, duplicataId).map((e) => reais(e.valorFmt)).reduce((t, v) => t + v, 0))} · ledger ${brl(pnlA)}`
  );

  // 13 -----------------------------------------------------------------------------
  secao('Supervisão — o admin cria um auditor, e o auditor enxerga a operação inteira');
  const auditorEmail = `${unico('auditor')}@operacao.test`;
  const criaAuditor = await post('/admin/auditores', adminToken, { nome: 'Auditoria da operação', email: auditorEmail, password: 'operacao-real-2026' });
  conferir('admin criou a conta de auditor', criaAuditor.status === 201, `status ${criaAuditor.status}`);
  const auditorToken = await login(auditorEmail, 'operacao-real-2026');
  const painel = await get('/auditor/overview', auditorToken);
  conferir('painel do auditor responde', painel.status === 200);
  conferir('a cadeia de hash do log de auditoria está íntegra', painel.body.auditLog?.chain?.valid === true, `${painel.body.auditLog?.entries?.length ?? 0} eventos`);
  const acoes = (painel.body.auditLog?.entries ?? []).map((e) => e.action);
  for (const esperada of ['aceite.aceita', 'duplicata.pagamento_reportado']) {
    conferir(`o log registrou "${esperada}"`, acoes.includes(esperada));
  }
  const otcAuditada = (painel.body.otc?.recentes ?? []).find((n) => n.duplicataId === duplicataId);
  conferir('a negociação de balcão aparece pro auditor', !!otcAuditada, otcAuditada ? `${otcAuditada.valorFmt} (face ${otcAuditada.valorFaceFmt}) · ${otcAuditada.rodadas} rodadas · ${otcAuditada.status}` : 'ausente');
  conferir('e com as duas rodadas que aconteceram de verdade', otcAuditada?.rodadas === 2, `rodadas: ${otcAuditada?.rodadas}`);

  console.log(`\n\x1b[1mDuplicata da operação:\x1b[0m ${duplicataId}`);
  console.log(`\x1b[1mAuditor:\x1b[0m ${auditorEmail} / operacao-real-2026`);
  console.log(`\x1b[1mInvestidor A (credor final):\x1b[0m ${invA.email} / operacao-real-2026`);
  return falhas.length;
}

main()
  .then((n) => {
    if (n === 0) console.log('\n\x1b[32mOperação real concluída — todas as conferências passaram.\x1b[0m');
    else {
      console.log(`\n\x1b[31m${n} conferência(s) falharam:\x1b[0m`);
      for (const f of falhas) console.log(`   • ${f}`);
    }
    process.exit(n === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error('\n\x1b[31mErro:\x1b[0m', err);
    process.exit(1);
  });
