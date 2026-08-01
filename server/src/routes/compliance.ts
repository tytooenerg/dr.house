import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { getSettings, updateSettings } from '../db/users.js';
import { db } from '../db/index.js';
import { AUDIT_LOG, CRONOGRAMA, CONTRACT_FLAGS, FINANCIADOR_REQS, TRUST_BRIDGE } from '../data/seed.js';
import { REGISTRADORAS } from '../lib/registradoras.js';
import { checkDuplicidade } from '../lib/dupCheck.js';
import { computeFraudFlags } from '../lib/fraudDetection.js';
import { computeProvisioning } from '../lib/provisioning.js';
import { fmtBRL, parseBRLNumber, fmtRelative } from '../lib/format.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { getLatestContractAnalysis } from '../db/contractAnalyses.js';
import { COLORS } from '../data/seed.js';

const SEVERITY_COLOR: Record<'ok' | 'atencao' | 'critico', string> = { ok: COLORS.GREEN, atencao: COLORS.AMBER, critico: COLORS.RED };

// Real analysis (lib/contractAnalysis.ts, triggered from POST /api/uploads with
// kind=contrato_cessao) when the cedente has uploaded a contract; the static demo copy
// otherwise, clearly marked as such by contractFlagsReal so the UI can show/hide the
// "Simulado" badge accordingly.
function contractFlagsPayload(userId: number) {
  const latest = getLatestContractAnalysis(userId);
  if (!latest) return { contractFlags: CONTRACT_FLAGS, contractFlagsReal: false, contractAnalyzedFilename: null };
  return {
    contractFlags: latest.flags.map((f) => ({ text: f.text, color: SEVERITY_COLOR[f.severity] })),
    contractFlagsReal: true,
    contractAnalyzedFilename: latest.filename,
  };
}

export const complianceRouter = Router();
complianceRouter.use(requireAuth);

function fidcPayload(pl: string) {
  const num = parseBRLNumber(pl);
  return { fidcPL: pl, fidcOriginacaoFmt: fmtBRL(num * 2.2), fidcSpreadLabel: '1,8% a.m.' };
}

// Real interoperability status per registradora: when it last actually processed a
// duplicata on Lastro, instead of a decorative fixed countdown.
function interopStatus() {
  return REGISTRADORAS.map((r) => {
    const last = db
      .prepare('SELECT created_at FROM duplicatas WHERE registradora = ? ORDER BY created_at DESC LIMIT 1')
      .get(r.key) as { created_at: string } | undefined;
    return { name: r.name, lastCheck: last ? fmtRelative(last.created_at) : 'sem operações ainda' };
  });
}

complianceRouter.get('/', (req, res) => {
  const settings = getSettings(req.user!);
  res.json({
    trustBridge: TRUST_BRIDGE,
    financiadorReqs: FINANCIADOR_REQS,
    cronograma: CRONOGRAMA,
    auditLog: AUDIT_LOG,
    fraudFlags: computeFraudFlags(),
    ...contractFlagsPayload(req.user!.id),
    interop: interopStatus(),
    ...fidcPayload(settings.fidcPL),
  });
});

const fidcSchema = z.object({ value: z.string().trim() });

complianceRouter.post('/fidc', (req, res) => {
  const parsed = fidcSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  updateSettings(req.user!.id, { fidcPL: parsed.data.value });
  res.json(fidcPayload(parsed.data.value));
});

// Real check against Lastro's own book, plus a real check against whichever registradora
// each match was actually registered with when that registradora has API credentials
// configured (see lib/dupCheck.ts and lib/registradoras.ts).
complianceRouter.post(
  '/dup-check',
  asyncHandler(async (req, res) => {
    const query = typeof req.body.query === 'string' ? req.body.query : '';
    const result = await checkDuplicidade(query);
    res.json({ dupQuery: query, dupChecked: true, ...result });
  })
);

complianceRouter.get('/provisionamento', (req, res) => {
  const { rows, summary } = computeProvisioning(req.user!.id);
  res.json({
    rows: rows.map((r) => ({ ...r, estagioLabel: { estagio_1: 'Estágio 1', estagio_2: 'Estágio 2', estagio_3: 'Estágio 3' }[r.estagio] })),
    summary,
  });
});

complianceRouter.get('/provisionamento/export.csv', (req, res) => {
  const { rows } = computeProvisioning(req.user!.id);
  const header = 'Duplicata,Sacado,Valor,Vencimento,DiasAtraso,Estagio';
  const lines = rows.map((r) => [r.duplicataId, csvEscape(r.sacadoNome), r.valorFmt, r.vencimento, r.diasAtraso, r.estagio].join(','));
  const csv = [header, ...lines].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="provisionamento.csv"');
  res.send(csv);
});

function csvEscape(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

