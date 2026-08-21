import { listAllDuplicatasForTraining } from '../db/duplicatas.js';
import { fmtBRL } from './format.js';
import type { DuplicataRow } from '../db/types.js';

// A network-shaped complement to the existing per-transaction fraud checks (dupCheck.ts's
// same-value-same-vencimento duplicidade, emitirCore.ts's 3x-average valor anômalo alert):
// those look at one duplicata at a time; this looks at the *shape* of a cedente's whole
// book across every duplicata they've ever issued — real graph/statistics over real rows,
// computed fresh on every call rather than a cached/persisted verdict, so it always
// reflects the current state instead of a stale one.

export interface FraudAnomalyFinding {
  tipo: 'concentracao_anomala' | 'autorrelacionamento';
  severidade: 'atencao' | 'critico';
  cedenteId: number | null;
  cedenteNome: string;
  sacadoNome: string;
  descricao: string;
  evidencia: Record<string, unknown>;
}

const MIN_DUPLICATAS_FOR_CONCENTRATION = 3;
const CONCENTRATION_THRESHOLD = 0.8;
const MIN_VALOR_FOR_CONCENTRATION = 50_000;

// A healthy cedente sells to a spread of buyers. A cedente whose entire (or nearly entire)
// emitted volume is concentrated in one single sacado is the classic shape of related-party
// or fabricated invoicing — flagging the *pattern*, not any single transaction, is exactly
// what a per-duplicata check can't see.
export function detectConcentracaoAnomala(rows: DuplicataRow[] = listAllDuplicatasForTraining()): FraudAnomalyFinding[] {
  const byCedente = new Map<number, DuplicataRow[]>();
  for (const d of rows) {
    if (d.cedente_id == null) continue;
    const arr = byCedente.get(d.cedente_id) ?? [];
    arr.push(d);
    byCedente.set(d.cedente_id, arr);
  }

  const findings: FraudAnomalyFinding[] = [];
  for (const ds of byCedente.values()) {
    if (ds.length < MIN_DUPLICATAS_FOR_CONCENTRATION) continue;
    const totalValor = ds.reduce((s, d) => s + d.valor, 0);
    if (totalValor < MIN_VALOR_FOR_CONCENTRATION) continue;

    const bySacado = new Map<string, { valor: number; count: number; nome: string }>();
    for (const d of ds) {
      const key = d.sacado_cnpj || d.sacado_nome;
      const cur = bySacado.get(key) ?? { valor: 0, count: 0, nome: d.sacado_nome };
      cur.valor += d.valor;
      cur.count += 1;
      bySacado.set(key, cur);
    }

    for (const agg of bySacado.values()) {
      const share = agg.valor / totalValor;
      if (share >= CONCENTRATION_THRESHOLD && agg.count >= MIN_DUPLICATAS_FOR_CONCENTRATION) {
        findings.push({
          tipo: 'concentracao_anomala',
          severidade: share >= 0.95 ? 'critico' : 'atencao',
          cedenteId: ds[0].cedente_id,
          cedenteNome: ds[0].cedente_nome,
          sacadoNome: agg.nome,
          descricao: `${(share * 100).toFixed(0)}% do volume emitido por este cedente (${fmtBRL(totalValor)} em ${ds.length} duplicata(s)) está concentrado em um único sacado — padrão atípico para uma carteira diversificada.`,
          evidencia: { totalValor, valorConcentrado: agg.valor, quantidadeDuplicatasComEsteSacado: agg.count, quantidadeTotalDuplicatas: ds.length, share },
        });
      }
    }
  }
  return findings;
}

// Cedente and sacado are the same company (by name) on the same duplicata — a company
// appearing to sell to itself. A blunt, exact-name heuristic (a determined bad actor would
// vary the name slightly) but a real, honest one: it flags what it can actually detect,
// nothing invented for cases it can't.
export function detectAutorrelacionamento(rows: DuplicataRow[] = listAllDuplicatasForTraining()): FraudAnomalyFinding[] {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const findings: FraudAnomalyFinding[] = [];
  for (const d of rows) {
    if (!d.cedente_nome.trim() || !d.sacado_nome.trim()) continue;
    if (normalize(d.cedente_nome) === normalize(d.sacado_nome)) {
      findings.push({
        tipo: 'autorrelacionamento',
        severidade: 'critico',
        cedenteId: d.cedente_id,
        cedenteNome: d.cedente_nome,
        sacadoNome: d.sacado_nome,
        descricao: `Duplicata ${d.id}: o nome do sacado é idêntico ao do cedente emissor (${fmtBRL(d.valor)}) — possível autorrelacionamento.`,
        evidencia: { duplicataId: d.id, valor: d.valor },
      });
    }
  }
  return findings;
}

export function runFraudAnomalyScan(): FraudAnomalyFinding[] {
  const rows = listAllDuplicatasForTraining();
  return [...detectAutorrelacionamento(rows), ...detectConcentracaoAnomala(rows)];
}
