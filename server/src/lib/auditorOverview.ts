import { listAuditLog, verifyAuditChain } from '../db/audit.js';
import { listFlags } from '../db/reconciliation.js';
import { listSuspiciousActivityReports } from '../db/suspiciousActivity.js';
import { listPendingComplianceReview } from '../db/complianceEngine.js';
import { listAllDisputesForAudit } from '../db/disputes.js';
import { fmtBRL, fmtRelative } from './format.js';

// Read-only aggregation for the 'auditor' role (routes/auditor.ts) — every number here is
// assembled from the exact same tables the admin back-office already reads (audit_log,
// reconciliation_flags, suspicious_activity_reports, compliance_engine_results), just
// without any of the write endpoints admin gets alongside them. No new data, no new
// computation — this module only exists to draw a read-only line through data that
// otherwise lives behind admin-only routes.
export interface AuditorOverview {
  auditLog: { entries: { id: number; actor: string; action: string; quando: string; hash: string }[]; chain: { valid: boolean; brokenAt: number | null } };
  compliance: { pendentes: number; itens: { duplicataId: string; sacadoNome: string; valorFmt: string; score: number }[] };
  reconciliation: { abertas: number; resolvidas: number; recentes: { tipo: string; empresa: string; valorFmt: string; status: string; quando: string }[] };
  sars: { aberto: number; descartado: number; reportado_coaf: number };
  // Achado corrigido (simulação multi-papel): o auditor não tinha nenhuma visão de
  // disputas — o admin via tudo em GET /admin/disputes, o auditor não via nada
  // equivalente. Mesmo formato abertas/resolvidas/recentes que reconciliation já usa.
  disputas: {
    abertas: number;
    resolvidas: number;
    recentes: { duplicataId: string; sacado: string; cedente: string; valorFmt: string; resolved: boolean; quando: string }[];
  };
}

export function buildAuditorOverview(): AuditorOverview {
  const auditRows = listAuditLog(100);
  const auditLog = {
    entries: auditRows.map((e) => ({ id: e.id, actor: e.actor_label, action: e.action, quando: fmtRelative(e.created_at), hash: e.hash.slice(0, 12) })),
    chain: verifyAuditChain(),
  };

  const complianceRows = listPendingComplianceReview();
  const compliance = {
    pendentes: complianceRows.length,
    itens: complianceRows.slice(0, 30).map((c) => ({ duplicataId: c.duplicata_id, sacadoNome: c.sacado_nome, valorFmt: fmtBRL(c.valor), score: c.score })),
  };

  const allFlags = listFlags();
  const reconciliation = {
    abertas: allFlags.filter((f) => f.status === 'aberta').length,
    resolvidas: allFlags.filter((f) => f.status === 'resolvida').length,
    recentes: allFlags.slice(0, 20).map((f) => ({ tipo: f.tipo, empresa: f.company_name, valorFmt: fmtBRL(f.valor), status: f.status, quando: fmtRelative(f.created_at) })),
  };

  const allSars = listSuspiciousActivityReports();
  const sars = {
    aberto: allSars.filter((r) => r.status === 'aberto').length,
    descartado: allSars.filter((r) => r.status === 'descartado').length,
    reportado_coaf: allSars.filter((r) => r.status === 'reportado_coaf').length,
  };

  const allDisputes = listAllDisputesForAudit();
  const disputas = {
    abertas: allDisputes.filter((d) => !d.resolved).length,
    resolvidas: allDisputes.filter((d) => d.resolved).length,
    recentes: allDisputes.slice(0, 20).map((d) => ({
      duplicataId: d.duplicata_id,
      sacado: d.sacado_nome,
      cedente: d.cedente_nome,
      valorFmt: fmtBRL(d.valor),
      resolved: !!d.resolved,
      quando: fmtRelative(d.created_at),
    })),
  };

  return { auditLog, compliance, reconciliation, sars, disputas };
}
