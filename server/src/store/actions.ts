import { state } from './state.js';
import { AUTO_BID_OFFERS } from '../data/seed.js';
import { parseBRLNumber } from '../lib/format.js';
import type { AceiteStatus, Role } from './state.js';
import { getLastroChecklist } from './computed.js';

export function selectRole(role: Role) {
  state.pickedRole = role;
}

export function enterPlatform(): { needsKyb: boolean } {
  if (!state.pickedRole) return { needsKyb: false };
  if (state.pickedRole === 'investidor' && !state.kybDone) {
    state.showKyb = true;
    return { needsKyb: true };
  }
  const role = state.pickedRole;
  state.isLoggedIn = true;
  state.userRole = role;
  state.showOnboarding = true;
  state.onboardingStep = 0;
  return { needsKyb: false };
}

export function updateKybForm(field: 'cnpj' | 'tipo' | 'pl', value: string) {
  (state.kybForm as any)[field] = value;
}

export function kybNext() {
  if (state.kybStep >= 2) {
    state.kybDone = true;
    state.showKyb = false;
    state.isLoggedIn = true;
    state.userRole = 'investidor';
    state.showOnboarding = true;
    state.onboardingStep = 0;
  } else {
    state.kybStep += 1;
  }
}

export function kybBack() {
  state.kybStep = Math.max(0, state.kybStep - 1);
}

export function logout() {
  state.isLoggedIn = false;
  state.pickedRole = null;
  state.userRole = null;
  state.showKyb = false;
  state.kybStep = 0;
  state.showOnboarding = false;
  state.onboardingStep = 0;
}

export function onboardingNext(totalSteps: number) {
  if (state.onboardingStep >= totalSteps - 1) {
    state.showOnboarding = false;
  } else {
    state.onboardingStep += 1;
  }
}

export function skipOnboarding() {
  state.showOnboarding = false;
}

export function toggleOfferExpand(id: number) {
  state.expandedOfferId = state.expandedOfferId === id ? null : id;
  if (state.expandedOfferId === id) state.offerExpandedAt[id] = Date.now();
}

export function buyOffer(id: number) {
  state.purchased[id] = true;
}

export function selectInsurer(id: number, key: string | null) {
  state.insuredOffers[id] = key;
}

export function setMarketQuery(q: string) {
  state.marketQuery = q;
}

export function setMarketSort(sort: string) {
  state.marketSort = sort;
}

export function dispararLeilao(id: string) {
  state.leiloesDisparados[id] = true;
}

export function updateEmitForm(field: keyof typeof state.emitForm, value: string | boolean) {
  (state.emitForm as any)[field] = value;
}

export function toggleNfAnexada() {
  const nowAttached = !state.nfAnexada;
  if (nowAttached && !state.emitForm.sacado) {
    state.emitForm = { ...state.emitForm, sacado: 'Grupo Atlas Varejo', cnpj: '12.345.678/0001-90', valor: '84.500,00', vencimento: '2026-08-12' };
  }
  state.nfAnexada = nowAttached;
}

export function addBatchRow() {
  state.batchRows.push({ id: 'b' + Math.random().toString(16).slice(2, 8), valor: '' });
}

export function updateBatchRow(id: string, valor: string) {
  const row = state.batchRows.find((r) => r.id === id);
  if (row) row.valor = valor;
}

export function removeBatchRow(id: string) {
  state.batchRows = state.batchRows.filter((r) => r.id !== id);
}

export function toggleEmitSeguro() {
  state.emitForm.seguro = !state.emitForm.seguro;
}

export async function submitEmit(): Promise<{ ok: boolean; error?: string; registro?: string }> {
  const f = state.emitForm;
  if (!f.sacado?.trim() || !f.valor?.trim() || !f.vencimento) {
    state.emitError = 'Preencha empresa sacada, valor e vencimento antes de enviar.';
    return { ok: false, error: state.emitError };
  }
  state.emitError = null;
  state.emitLoading = true;
  await new Promise((r) => setTimeout(r, 1100));
  state.emitLoading = false;
  if (Math.random() < 0.12) {
    state.emitError = 'Falha ao registrar na CERC — conexão instável. Tente novamente.';
    return { ok: false, error: state.emitError };
  }
  const registro = 'ESC-2026-' + Math.floor(Math.random() * 900000 + 100000);
  state.lastRegistro = registro;
  state.emitSubmitted = true;
  const emitValorNum = parseBRLNumber(f.valor);
  const batchTotal = state.batchRows.reduce((sum, r) => sum + parseBRLNumber(r.valor), 0);
  state.emittedDuplicatas.push({
    id: 'e' + Math.random().toString(16).slice(2, 8),
    sacado: f.sacado,
    valor: emitValorNum + batchTotal,
    emissao: new Date().toLocaleDateString('pt-BR'),
    vencimento: f.vencimento.split('-').reverse().join('/'),
    status: 'Aprovada',
    lastro: getLastroChecklist().pct,
  });
  return { ok: true, registro };
}

export function resetEmit() {
  state.emitSubmitted = false;
  state.emitForm = { sacado: '', cnpj: '', valor: '', vencimento: '', seguro: false };
  state.batchRows = [];
  state.nfAnexada = false;
}

export async function setAceiteStatus(id: number, status: AceiteStatus) {
  state.pendingAceiteId = id;
  await new Promise((r) => setTimeout(r, 700));
  state.aceites[id] = status;
  state.pendingAceiteId = null;
}

export async function sendDisputeEvidence(id: number) {
  state.disputeEvidence[id] = 'enviando';
  await new Promise((r) => setTimeout(r, 700));
  state.disputeEvidence[id] = 'enviada';
}

export function setRiskQuery(q: string) {
  state.riskQuery = q;
  state.selectedSacadoName = null;
}

export function selectSacado(name: string) {
  state.selectedSacadoName = name;
  state.riskQuery = name;
}

export function clearSacado() {
  state.selectedSacadoName = null;
  state.riskQuery = '';
}

export function toggleAutoBid() {
  state.autoBidEnabled = !state.autoBidEnabled;
}

export function updateAutoBidRule(field: keyof typeof state.autoBidRules, value: string) {
  (state.autoBidRules as any)[field] = value;
}

export function updateDiversification(cls: 'AA' | 'A' | 'B' | 'C', value: number) {
  state.diversification[cls] = Math.max(0, Math.min(100, value));
}

export function updateSectorDiversification(cls: 'varejo' | 'industria' | 'construcao' | 'servicos', value: number) {
  state.sectorDiversification[cls] = Math.max(0, Math.min(100, value));
}

export function toggleErpConnection(key: keyof typeof state.erpConnections) {
  state.erpConnections[key] = !state.erpConnections[key];
}

export function updateComparadorInput(field: keyof typeof state.comparadorInput, value: string) {
  (state.comparadorInput as any)[field] = value;
}

export function updateFidcPL(value: string) {
  state.fidcPL = value;
}

export function runDupCheck() {
  state.dupChecked = true;
}

export function toggleKeyReveal() {
  state.liveKeyRevealed = !state.liveKeyRevealed;
}

export function toggleWebhook() {
  state.webhookEnabled = !state.webhookEnabled;
}

export function setPlaygroundEndpoint(key: string) {
  state.playgroundEndpoint = key;
  state.playgroundResult = null;
}

export function updatePlaygroundParam(field: string, value: string) {
  state.playgroundParams[field] = value;
}

export async function sendPlaygroundRequest() {
  const ep = state.playgroundEndpoint;
  state.playgroundLoading = true;
  await new Promise((r) => setTimeout(r, 700));
  const p = state.playgroundParams;
  let body: Record<string, unknown> = {};
  const status = 200;
  if (ep === 'emitir') {
    body = { id: 'dup_' + Math.random().toString(16).slice(2, 6), status: 'registrada', registro: 'ESC-2026-' + Math.floor(Math.random() * 900000 + 100000), sacado_cnpj: p.sacado_cnpj, valor: parseFloat(p.valor) || 0, vencimento: p.vencimento, seguro: p.seguro === 'true', leilao: 'aberto' };
  } else if (ep === 'consultar') {
    body = { id: p.duplicata_id, status: 'registrada', aceite: 'confirmado', titular_atual: 'Fornecedor Lima Ltda', leilao: 'aberto', lances: 3 };
  } else if (ep === 'lance') {
    const taxaNum = parseFloat(p.taxa) || 0;
    body = { leilao_id: p.leilao_id, lance_id: 'bid_' + Math.random().toString(16).slice(2, 6), taxa: taxaNum, posicao: taxaNum < 2 ? 1 : 2, status: 'ativo' };
  } else if (ep === 'score') {
    body = { cnpj: p.cnpj, score: 812, faixa: 'A', pd_12m: '1.4%', recomendacao: 'aprovar com deságio entre 1,8% e 2,3% a.m.' };
  } else if (ep === 'webhook') {
    body = { id: 'wh_' + Math.random().toString(16).slice(2, 6), url: p.url, evento: p.evento, status: 'ativo' };
  }
  state.playgroundLoading = false;
  const latency = Math.floor(120 + Math.random() * 180);
  state.playgroundResult = { status, latency, body: JSON.stringify(body, null, 2) };
  const eps: Record<string, { method: string; path: string }> = {
    emitir: { method: 'POST', path: '/v1/duplicatas' },
    consultar: { method: 'GET', path: '/v1/duplicatas/:id' },
    lance: { method: 'POST', path: '/v1/leiloes/:id/lances' },
    score: { method: 'GET', path: '/v1/sacados/:cnpj/score' },
    webhook: { method: 'POST', path: '/v1/webhooks' },
  };
  state.apiLog = [{ status: String(status), method: eps[ep].method, path: eps[ep].path, time: 'agora' }, ...state.apiLog].slice(0, 6);
  return state.playgroundResult;
}

export function updateProfileForm(field: keyof typeof state.profileForm, value: string) {
  (state.profileForm as any)[field] = value;
}

export function toggleNotifPref(key: keyof typeof state.notifPrefs) {
  state.notifPrefs[key] = !state.notifPrefs[key];
}

export function inviteMember(nome: string, email: string) {
  state.teamMembers.push({ nome, email, papel: 'Somente leitura' });
}

export function connectBank() {
  state.kycBankConnected = true;
}

export function uploadDocs() {
  state.kycDocsAttempts += 1;
  if (state.kycDocsAttempts === 1) {
    state.kycDocsRejected = true;
  } else {
    state.kycDocsRejected = false;
    state.kycDocsUploaded = true;
  }
}

export function setSettlementSpeed(speed: 'd0' | 'd1') {
  state.settlementSpeed = speed;
}

export function markNotifRead() {
  state.notifRead = true;
}

let lastAutoBidTick = 0;
export function maybeTickAutoBid() {
  if (!state.autoBidEnabled) return;
  const now = Date.now();
  if (now - lastAutoBidTick < 4000) return;
  lastAutoBidTick = now;
  if (Math.random() > 0.5) return;
  const scoreOrder: Record<string, number> = { AA: 4, A: 3, B: 2, C: 1 };
  const minOrder = scoreOrder[state.autoBidRules.scoreMin] || 3;
  const weights = AUTO_BID_OFFERS.map((o) => Math.max(1, (state.diversification as any)[o.score] || 1));
  const totalW = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * totalW;
  let pick = AUTO_BID_OFFERS[0];
  for (let i = 0; i < AUTO_BID_OFFERS.length; i++) {
    if (r < weights[i]) { pick = AUTO_BID_OFFERS[i]; break; }
    r -= weights[i];
  }
  const passesScore = scoreOrder[pick.score] >= minOrder;
  const classAlloc = (state.diversification as any)[pick.score] || 0;
  const passes = passesScore && classAlloc > 0;
  const rate = (1.6 + Math.random() * 1.8).toFixed(1).replace('.', ',');
  const entry = passes
    ? { text: `Automação aplicada — lance de ${rate}% enviado em ${pick.sacado} (${pick.setor}, score ${pick.score}, ${classAlloc}% da carteira alocado nessa classe)`, color: '#0A5C36', time: 'agora' }
    : !passesScore
      ? { text: `Oferta de ${pick.sacado} ignorada — score ${pick.score} abaixo do mínimo configurado (${state.autoBidRules.scoreMin})`, color: '#5B6472', time: 'agora' }
      : { text: `Oferta de ${pick.sacado} ignorada — classe de score ${pick.score} está zerada na diversificação da carteira`, color: '#5B6472', time: 'agora' };
  state.autoBidActivity = [entry, ...state.autoBidActivity].slice(0, 8);
}
