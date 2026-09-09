import { listAuditLog, verifyAuditChain } from '../db/audit.js';
import { listFlags } from '../db/reconciliation.js';
import { listSuspiciousActivityReports } from '../db/suspiciousActivity.js';
import { listPendingComplianceReview } from '../db/complianceEngine.js';
import { listAllDisputesForAudit } from '../db/disputes.js';
import { listAllOtcForAudit, listOtcRodadas } from '../db/otc.js';
import { fmtBRL, fmtRelative } from './format.js';

// Read-only aggregation for the 'auditor' role (routes/auditor.ts). Cada número aqui é
// contado sobre as tabelas que já existem (audit_log, reconciliation_flags,
// suspicious_activity_reports, compliance_engine_results, disputes, otc_negociacoes) — o
// módulo agrega e formata, nunca estima nem inventa uma fonte.
//
// A maior parte disto é a mesma leitura que o back-office do admin já faz, sem nenhum dos
// endpoints de escrita que vêm junto lá. O balcão é a exceção: nem o admin tem uma visão
// dele. Não é omissão do admin — o balcão é privado entre as duas partes por desenho —, mas
// privacidade contra participantes do mercado não é sigilo contra a supervisão, e uma
// negociação onde preço e contraparte são combinados fora do book é exatamente o que um
// auditor precisa poder olhar. Ver db/otc.ts's listAllOtcForAudit.
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
  // O balcão (lib/otcCore.ts) é a única negociação da plataforma que acontece FORA de um
  // livro público: preço e contraparte combinados diretamente entre duas mesas. Era o que o
  // auditor menos enxergava e o que mais precisa enxergar.
  otc: {
    abertas: number;
    aceitas: number;
    encerradas: number;
    /** Volume das negociações que fecharam — o que efetivamente mudou de mãos no balcão. */
    volumeAceitoFmt: string;
    recentes: {
      id: number;
      duplicataId: string;
      sacado: string;
      comprador: string;
      vendedor: string;
      valorFmt: string;
      valorFaceFmt: string;
      status: string;
      rodadas: number;
      quando: string;
    }[];
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

  const allOtc = listAllOtcForAudit();
  const aceitas = allOtc.filter((n) => n.status === 'aceita');
  const otc = {
    abertas: allOtc.filter((n) => n.status === 'aberta').length,
    aceitas: aceitas.length,
    // Recusada, cancelada e expirada são o mesmo desfecho pro auditor: não liquidou.
    encerradas: allOtc.filter((n) => n.status !== 'aberta' && n.status !== 'aceita').length,
    volumeAceitoFmt: fmtBRL(aceitas.reduce((soma, n) => soma + n.valor, 0)),
    recentes: allOtc.slice(0, 20).map((n) => ({
      id: n.id,
      duplicataId: n.duplicata_id,
      sacado: n.sacado_nome,
      comprador: n.comprador_nome,
      vendedor: n.vendedor_nome,
      valorFmt: fmtBRL(n.valor),
      // O valor de face ao lado do negociado: é a comparação que denuncia um preço fora de
      // mercado, que é justamente o que se audita numa negociação bilateral.
      valorFaceFmt: fmtBRL(n.valor_face),
      status: n.status,
      rodadas: listOtcRodadas(n.id).length,
      quando: fmtRelative(n.created_at),
    })),
  };

  return { auditLog, compliance, reconciliation, sars, disputas, otc };
}
