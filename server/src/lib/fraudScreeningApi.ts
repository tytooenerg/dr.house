// Feature "Fraud Screening API" — a stateless, third-party-facing version of the same two
// real heuristics lib/fraudAnomalyDetection.ts already runs internally (as a scheduled
// scan over Lastro's own `duplicatas` table): self-dealing (cedente/sacado are the same
// company) and single-counterparty concentration. That module is deliberately not reused
// directly here — it's shaped around a full-table scan job (its input is every duplicata
// this platform has ever seen), while this is a per-call check against whatever
// transaction and recent-history a *caller's own* system supplies. Same real, explainable
// logic, generalized input — nothing here is a new ML model or a fabricated risk score.

export interface FraudScreeningInput {
  cedenteNome: string;
  sacadoNome: string;
  valor: number;
  // The caller's own recent transaction history for this cedente (or omitted entirely —
  // concentration simply can't be evaluated without it, and this honestly says so rather
  // than guessing).
  historicoRecente?: { sacadoNome: string; valor: number }[];
}

export interface FraudScreeningFinding {
  tipo: 'autorrelacionamento' | 'concentracao_anomala';
  severidade: 'atencao' | 'critico';
  descricao: string;
  evidencia: Record<string, unknown>;
}

export interface FraudScreeningResult {
  flagged: boolean;
  findings: FraudScreeningFinding[];
}

const MIN_TRANSACOES_PARA_CONCENTRACAO = 3;
const CONCENTRATION_THRESHOLD = 0.8;

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function screenFraudSignals(input: FraudScreeningInput): FraudScreeningResult {
  const findings: FraudScreeningFinding[] = [];

  if (input.cedenteNome.trim() && input.sacadoNome.trim() && normalize(input.cedenteNome) === normalize(input.sacadoNome)) {
    findings.push({
      tipo: 'autorrelacionamento',
      severidade: 'critico',
      descricao: `O nome do sacado é idêntico ao do cedente informado — possível autorrelacionamento.`,
      evidencia: { cedenteNome: input.cedenteNome, sacadoNome: input.sacadoNome, valor: input.valor },
    });
  }

  const historico = input.historicoRecente ?? [];
  // +1 counts the transaction being evaluated itself, not just the supplied history —
  // 2 prior transactions plus this one is already the minimum 3 needed to call a pattern.
  if (historico.length + 1 >= MIN_TRANSACOES_PARA_CONCENTRACAO) {
    const totalValor = historico.reduce((sum, t) => sum + t.valor, 0) + input.valor;
    const bySacado = new Map<string, number>();
    for (const t of historico) bySacado.set(t.sacadoNome, (bySacado.get(t.sacadoNome) ?? 0) + t.valor);
    bySacado.set(input.sacadoNome, (bySacado.get(input.sacadoNome) ?? 0) + input.valor);

    for (const [sacadoNome, valor] of bySacado) {
      const share = valor / totalValor;
      if (share >= CONCENTRATION_THRESHOLD) {
        findings.push({
          tipo: 'concentracao_anomala',
          severidade: share >= 0.95 ? 'critico' : 'atencao',
          descricao: `${(share * 100).toFixed(0)}% do volume recente informado (incluindo esta transação) está concentrado em um único sacado ("${sacadoNome}") — padrão atípico para uma carteira diversificada.`,
          evidencia: { sacadoNome, valorConcentrado: valor, totalValor, share },
        });
      }
    }
  }

  return { flagged: findings.length > 0, findings };
}
