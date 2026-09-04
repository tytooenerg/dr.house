// Populates the database with several months of realistic, backdated activity — volume,
// revenue, network signals, API usage — so the app tells a believable traction story when
// demoed live to investors, instead of showing the (correctly) near-empty state a fresh
// install has. Never runs automatically; invoke explicitly with `npm run seed:demo` in
// server/. Safe to re-run: it no-ops if it already ran once against this database.
import { db } from '../db/index.js';
import { seedIfEmpty } from '../db/seed.js';
import { createUser, approveKyb, updateSubscription, getUserByEmail } from '../db/users.js';
import { createDuplicata, dispararLeilao, setInsurer, createPurchase } from '../db/duplicatas.js';
import { createListing, setListingStatus, deactivatePurchase } from '../db/resaleListings.js';
import { ensureAceite, setAceiteStatus } from '../db/aceites.js';
import { addSignal } from '../db/networkSignals.js';
import { recordHealthCheck } from '../db/systemHealth.js';
import { createApiKey, incrementApiKeyUsage } from '../db/apiKeys.js';
import { createWebhook } from '../db/webhooks.js';
import { createDelivery, recordDeliveryAttempt } from '../db/webhookDeliveries.js';
import { addApiLog } from '../db/misc.js';
import { generateApiKey } from '../auth/apiKey.js';
import { hashPassword } from '../auth/password.js';
import { settlePurchase, settleInsurance, settleResale } from '../lib/settlement.js';
import { computePurchasePrice } from '../lib/marketCompute.js';
import { chooseRegistradora } from '../lib/registradoras.js';
import { INSURERS, SACADOS } from '../data/seed.js';
import crypto from 'node:crypto';

const MARKER_EMAIL = 'demo-cedente-01@lastro.demo';

function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min));
}
function daysAgoIso(days: number): string {
  const d = new Date(Date.now() - days * 24 * 3600 * 1000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}
function ddmmyyyy(daysFromNow: number): string {
  const d = new Date(Date.now() + daysFromNow * 24 * 3600 * 1000);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

const CEDENTE_COMPANIES = [
  'Nortex Distribuição Ltda',
  'Bravante Indústria e Comércio',
  'Cimenta Materiais de Construção',
  'Vívido Alimentos S.A.',
  'Cronos Tecnologia e Serviços',
  'Alameda Confecções Têxteis',
];

const INVESTOR_FUNDS = [
  'Andrômeda Capital FIDC',
  'Porto Seguro Investimentos',
  'Vetta Asset Management',
  'Cambuci Crédito Estruturado',
  'Rumo Norte Fundos',
];

const EXTRA_SACADOS = [
  'Comercial Rio das Pedras',
  'Mercantil Bela Vista Ltda',
  'Distribuidora Aurora Norte',
  'Rede Sertão Supermercados',
  'Grupo Marambaia Varejo',
];

async function main() {
  await seedIfEmpty();

  if (getUserByEmail(MARKER_EMAIL)) {
    console.log('[seed-investor-demo] already seeded — nothing to do.');
    return;
  }

  const demoPassword = await hashPassword('demo1234');

  console.log('[seed-investor-demo] creating cedente/investidor accounts…');
  const cedentes = [];
  let referralCode: string | undefined;
  for (let i = 0; i < CEDENTE_COMPANIES.length; i++) {
    const user = createUser({
      email: `demo-cedente-${String(i + 1).padStart(2, '0')}@lastro.demo`,
      passwordHash: demoPassword,
      nome: 'Equipe ' + CEDENTE_COMPANIES[i].split(' ')[0],
      companyName: CEDENTE_COMPANIES[i],
      role: 'cedente',
      referredByCode: i === 2 ? referralCode : undefined,
    });
    updateSubscription(user.id, { plan: i % 2 === 0 ? 'empresarial' : 'pro', subscriptionStatus: 'active_demo' });
    if (i === 0) referralCode = user.referral_code ?? undefined;
    cedentes.push(user);
  }

  const investidores = [];
  for (let i = 0; i < INVESTOR_FUNDS.length; i++) {
    const user = createUser({
      email: `demo-investidor-${String(i + 1).padStart(2, '0')}@lastro.demo`,
      passwordHash: demoPassword,
      nome: 'Equipe ' + INVESTOR_FUNDS[i].split(' ')[0],
      companyName: INVESTOR_FUNDS[i],
      role: 'investidor',
    });
    approveKyb(user.id);
    updateSubscription(user.id, { plan: i === 0 ? 'empresarial' : 'pro', subscriptionStatus: 'active_demo' });
    investidores.push(user);
  }

  const sacadoPool = [...Object.keys(SACADOS), ...EXTRA_SACADOS];

  console.log('[seed-investor-demo] emitting and settling duplicatas across the last 120 days…');
  let totalEmitido = 0;
  let totalFinanciado = 0;
  let totalTaxas = 0;
  let totalPremios = 0;
  let totalComissaoSeguro = 0;
  let countPurchased = 0;
  let countInsured = 0;
  let countResold = 0;

  for (let i = 0; i < 60; i++) {
    const cedente = rand(cedentes);
    const sacadoNome = rand(sacadoPool);
    const sacado = SACADOS[sacadoNome];
    const valor = randInt(8_000, 350_000);
    const daysAgo = randInt(1, 120);
    const registradora = chooseRegistradora(valor);

    const d = createDuplicata({
      cedenteId: cedente.id,
      cedenteNome: cedente.company_name,
      sacadoNome,
      sacadoCnpj: sacado?.cnpj ?? '',
      valor,
      vencimento: ddmmyyyy(randInt(15, 90)),
      emissao: daysAgoIso(daysAgo).slice(0, 10).split('-').reverse().join('/'),
      status: 'aprovada',
      lastroPct: 100,
      seguro: false,
      registro: 'ESC-2026-' + randInt(100000, 999999),
      registradora: registradora.key,
    });
    db.prepare('UPDATE duplicatas SET created_at = ? WHERE id = ?').run(daysAgoIso(daysAgo), d.id);
    totalEmitido += valor;

    dispararLeilao(d.id, new Date(Date.now() + 6 * 3600 * 1000).toISOString());
    const aceite = ensureAceite(d.id, `${randInt(2, 10)} dias úteis restantes`);
    const aceiteRoll = Math.random();
    const aceiteStatus = aceiteRoll < 0.78 ? 'aceita' : aceiteRoll < 0.92 ? 'aguardando' : 'contestada';
    setAceiteStatus(aceite.id, aceiteStatus);
    if (aceiteStatus !== 'aguardando' && sacado?.cnpj) {
      addSignal(sacado.cnpj, cedente.id, aceiteStatus === 'aceita' ? 'pagamento_pontual' : 'contestacao');
    }

    if (aceiteStatus !== 'contestada' && Math.random() < 0.75) {
      const investor = rand(investidores);
      const demoRate = 1.5 + Math.random() * 3;
      const { precoCompra } = computePurchasePrice(d, demoRate);
      createPurchase(d.id, investor.id, valor, `${demoRate.toFixed(1)}%`, Math.round(valor - precoCompra));
      const purchaseRow = db.prepare('SELECT id, created_at FROM purchases WHERE duplicata_id = ? ORDER BY id DESC LIMIT 1').get(d.id) as {
        id: number;
        created_at: string;
      };
      const purchaseDaysAgo = Math.max(0, daysAgo - randInt(0, 3));
      db.prepare('UPDATE purchases SET created_at = ? WHERE id = ?').run(daysAgoIso(purchaseDaysAgo), purchaseRow.id);
      const { fee } = settlePurchase({ duplicataId: d.id, sacadoNome, investorId: investor.id, cedenteId: cedente.id, valor, precoCompra });
      totalFinanciado += valor;
      totalTaxas += fee;
      countPurchased++;

      if (Math.random() < 0.3) {
        const insurer = rand(INSURERS);
        setInsurer(d.id, insurer.key);
        const seguradoraUser = getUserByEmail('seguradora@lastro.demo');
        const premio = valor * (insurer.premioPct / 100);
        const { comissao } = settleInsurance({
          duplicataId: d.id,
          investorId: investor.id,
          insurerKey: insurer.key,
          insurerUserId: insurer.key === 'too' ? seguradoraUser?.id ?? null : null,
          premio,
        });
        totalPremios += premio;
        totalComissaoSeguro += comissao;
        countInsured++;
      }

      if (Math.random() < 0.18) {
        const seller = investor;
        let buyer = rand(investidores);
        while (buyer.id === seller.id) buyer = rand(investidores);
        const askingValor = Math.round(valor * (1 + (Math.random() * 0.06 - 0.02)));
        const listing = createListing(purchaseRow.id, d.id, seller.id, askingValor);
        const { fee: resaleFee, net: resaleNet } = settleResale({ duplicataId: d.id, sacadoNome, buyerId: buyer.id, sellerId: seller.id, valor: askingValor });
        // Retorno real do vendedor: líquido recebido na revenda menos o que ele pagou
        // originalmente (precoCompra) — mesmo cálculo de lib/resaleCore.ts's
        // executeResaleTrade, pra dado seedado não mostrar o mesmo número fabricado que a
        // correção real fechou.
        deactivatePurchase(purchaseRow.id, Math.round(resaleNet - precoCompra));
        createPurchase(d.id, buyer.id, askingValor, `${(1.5 + Math.random() * 3).toFixed(1)}%`, Math.round(valor - askingValor));
        setListingStatus(listing.id, 'vendido');
        totalTaxas += resaleFee;
        countResold++;
      }
    }
  }

  console.log('[seed-investor-demo] seeding cross-platform network signals…');
  const novoCnpj1 = '11444777000161';
  const novoCnpj2 = '07526557000100';
  addSignal(novoCnpj1, rand(investidores).id, 'pagamento_pontual', 'Reportado via integração API');
  addSignal(novoCnpj1, rand(cedentes).id, 'pagamento_pontual');
  addSignal(novoCnpj2, rand(cedentes).id, 'atraso', 'Atraso de 12 dias reportado por parceiro');

  console.log('[seed-investor-demo] seeding Desenvolvedores activity (API keys, webhooks, usage)…');
  const devCedente = cedentes[0];
  const { keyHash, keyPrefix } = generateApiKey('live');
  const apiKey = createApiKey(devCedente.id, keyHash, keyPrefix, 'Chave de produção', 'live', 'read_write');
  for (let i = 0; i < 340; i++) incrementApiKeyUsage(apiKey.id);
  const webhook = createWebhook(devCedente.id, 'https://erp.nortexdistribuicao.com.br/webhooks/lastro', 'duplicata.registrada', `whsec_${crypto.randomBytes(16).toString('hex')}`);
  for (let i = 0; i < 12; i++) {
    const delivery = createDelivery(webhook.id, 'duplicata.registrada', JSON.stringify({ event: 'duplicata.registrada', data: { demo: true } }));
    recordDeliveryAttempt(delivery.id, 1, i === 11 ? 'failed' : 'success', i === 11 ? 503 : 200, i === 11 ? 'HTTP 503' : null);
  }
  const V1_PATHS = ['/v1/duplicatas', '/v1/marketplace', '/v1/aceites', '/v1/sacados/{cnpj}/score'];
  for (let i = 0; i < 25; i++) addApiLog(devCedente.id, '200', rand(['GET', 'POST']), rand(V1_PATHS));

  console.log('[seed-investor-demo] seeding 14 days of status-page health-check history…');
  for (let hoursAgo = 14 * 24; hoursAgo >= 0; hoursAgo -= 1) {
    const degraded = hoursAgo === 200 || hoursAgo === 47;
    const ts = new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    db.prepare("INSERT INTO system_health_checks (status, latency_ms, created_at) VALUES (?, ?, ?)").run(
      degraded ? 'degraded' : 'ok',
      degraded ? randInt(400, 900) : randInt(12, 55),
      ts
    );
  }
  recordHealthCheck('ok', randInt(12, 40));

  console.log('\n[seed-investor-demo] done. Summary:');
  console.log(`  Cedentes: ${cedentes.length} | Investidores: ${investidores.length}`);
  console.log(`  Duplicatas emitidas: 60 (R$ ${totalEmitido.toLocaleString('pt-BR')})`);
  console.log(`  Compradas: ${countPurchased} (R$ ${totalFinanciado.toLocaleString('pt-BR')} financiados)`);
  console.log(`  Seguradas: ${countInsured} (R$ ${Math.round(totalPremios).toLocaleString('pt-BR')} em prêmios)`);
  console.log(`  Revendidas no mercado secundário: ${countResold}`);
  console.log(`  Taxa de plataforma coletada: R$ ${Math.round(totalTaxas).toLocaleString('pt-BR')}`);
  console.log(`  Comissão de seguro coletada: R$ ${Math.round(totalComissaoSeguro).toLocaleString('pt-BR')}`);
  console.log('\nContas de demonstração (senha: demo1234):');
  for (const c of cedentes) console.log(`  cedente: ${c.email} — ${c.company_name}`);
  for (const i2 of investidores) console.log(`  investidor: ${i2.email} — ${i2.company_name}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed-investor-demo] failed:', err);
    process.exit(1);
  });
