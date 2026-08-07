import { listActiveCedentes, getSettings } from '../db/users.js';
import { isAlreadyImported, recordAutoEmitImport, type AutoEmitFonte } from '../db/autoEmitImports.js';
import { addAutomationActivity } from '../db/misc.js';
import { submitEmitir, type EmitirForm } from './emitirCore.js';
import { listarContasReceberOmie } from './erpConnectors/omie.js';
import { listarContasReceberSap } from './erpConnectors/sap.js';
import { listarContasReceberTotvs } from './erpConnectors/totvs.js';
import { parseBRLNumber } from './format.js';
import { COLORS } from '../data/seed.js';
import { logger } from './logger.js';
import type { UserRow } from '../db/types.js';

// Opt-in ERP → duplicata pipeline (Integrações ERP's "Emissão automática" toggle) —
// closes the gap this repo previously left manual: the old flow only *pre-filled* Emitir
// Duplicata from the ERP, the cedente still had to click submit. This still respects the
// same "cedente keeps the botão de comando" principle every automated feature in this app
// follows (Automação de Lances, aceite reminders): opt-in per account, a hard valor cap,
// and every emission still goes through submitEmitir's full real pipeline (duplicidade
// check, compliance engine, registradora) — nothing here bypasses those checks.

interface AutoEmitCandidate {
  fonte: AutoEmitFonte;
  externalId: string;
  cliente: string;
  valor: number;
  vencimento: string;
}

async function collectCandidates(user: UserRow): Promise<AutoEmitCandidate[]> {
  const settings = getSettings(user);
  const out: AutoEmitCandidate[] = [];

  if (settings.erpConnections.omie && settings.omieCredentials) {
    const r = await listarContasReceberOmie(settings.omieCredentials.appKey, settings.omieCredentials.appSecret).catch(() => ({ ok: false as const, contas: [] }));
    if (r.ok) out.push(...r.contas.map((c) => ({ fonte: 'omie' as const, externalId: String(c.codigoLancamento), cliente: c.cliente, valor: c.valor, vencimento: c.vencimento })));
  }
  if (settings.erpConnections.sap && settings.sapCredentials) {
    const { baseUrl, companyDb, username, password } = settings.sapCredentials;
    const r = await listarContasReceberSap(baseUrl, companyDb, username, password).catch(() => ({ ok: false as const, contas: [] }));
    if (r.ok) out.push(...r.contas.map((c) => ({ fonte: 'sap' as const, externalId: c.id, cliente: c.cliente, valor: c.valor, vencimento: c.vencimento })));
  }
  if (settings.erpConnections.totvs && settings.totvsCredentials) {
    const { baseUrl, clientId, clientSecret } = settings.totvsCredentials;
    const r = await listarContasReceberTotvs(baseUrl, clientId, clientSecret).catch(() => ({ ok: false as const, contas: [] }));
    if (r.ok) out.push(...r.contas.map((c) => ({ fonte: 'totvs' as const, externalId: c.id, cliente: c.cliente, valor: c.valor, vencimento: c.vencimento })));
  }
  return out;
}

export async function runAutoEmitForUser(user: UserRow): Promise<{ emitidas: number }> {
  const settings = getSettings(user);
  if (!settings.autoEmitEnabled) return { emitidas: 0 };
  const maxValor = parseBRLNumber(settings.autoEmitMaxValor) || Infinity;

  const candidates = await collectCandidates(user);
  let emitidas = 0;
  for (const c of candidates) {
    if (isAlreadyImported(user.id, c.fonte, c.externalId)) continue;
    if (c.valor > maxValor) continue;
    const form: EmitirForm = {
      sacado: c.cliente,
      cnpj: '',
      valor: c.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      vencimento: c.vencimento,
      seguro: false,
      nfAnexada: true,
      nfeChave: '',
      batchValores: [],
    };
    try {
      const outcome = await submitEmitir(user, form);
      if (outcome.status === 200) {
        recordAutoEmitImport(user.id, c.fonte, c.externalId, outcome.body.duplicataId);
        addAutomationActivity(user.id, `Emissão automática via ${c.fonte.toUpperCase()}: duplicata ${outcome.body.duplicataId} (${c.cliente})`, COLORS.GREEN);
        emitidas++;
      } else {
        // Not recorded as imported — a transient/legitimate block (duplicidade,
        // registradora instável, limite de plano) should be retried on the next cycle,
        // not silently swallowed forever.
        logger.info({ userId: user.id, fonte: c.fonte, externalId: c.externalId, status: outcome.status }, '[auto-emit] emissão não concluída — tentará novamente no próximo ciclo');
      }
    } catch (err) {
      logger.warn({ err, userId: user.id, fonte: c.fonte }, '[auto-emit] falha ao emitir automaticamente');
    }
  }
  return { emitidas };
}

async function runCheck() {
  for (const user of listActiveCedentes()) {
    await runAutoEmitForUser(user).catch((err) => logger.warn({ err, userId: user.id }, '[auto-emit] falha ao processar cedente'));
  }
}

// Only started from src/index.ts (the real server process), same pattern as
// startAceiteReminderJob/startHealthMonitor — importing app.ts in tests never spins up a
// background timer.
export function startAutoEmitJob(intervalMs = 30 * 60 * 1000): NodeJS.Timeout {
  runCheck();
  return setInterval(runCheck, intervalMs);
}
