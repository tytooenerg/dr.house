import type { DuplicataRow, UserRow } from '../db/types.js';
import { listByCedente, listBySacadoNome, listPurchasesByInvestor } from '../db/duplicatas.js';
import { listAceitesBySacadoNome } from '../db/aceites.js';
import { effectiveOwnerId } from '../db/users.js';
import { precoPago } from './investorPositions.js';
import { effectiveMonthlyRatePct } from './marketCompute.js';
import { ratingFromScore } from './riscoCore.js';
import { fmtBRL, parseFlexibleDate, toIsoUtc } from './format.js';
import { COLORS } from '../data/seed.js';

// Antes desta mudança, TODO o dashboard era constante: os 4 KPIs vinham de `KPIS_RAW`
// (data/seed.ts — "R$ 128,4M", "342 duplicatas ativas"...), as barras mensais de
// `MONTHS_RAW` e os cortes do donut/legenda eram literais no próprio routes/dashboard.ts.
// Investidor, cedente e sacado viam exatamente os mesmos números, que não tinham relação
// nenhuma com a conta de quem estava olhando — e a tela se contradizia sozinha, porque
// `activeDuplicatas` (o único número real, no centro do donut) mostrava as operações de
// verdade enquanto o card ao lado anunciava 342.
//
// Agora cada papel vê os seus próprios números, calculados do banco. Quando não há dado
// suficiente pra uma métrica, ela vem como '—' com uma explicação curta em vez de um zero
// ambíguo ou de um número inventado — mesma disciplina de rotulagem honesta que o resto do
// código já segue ("modo simulado", "faixa teórica", etc.).

export interface DashboardKpi {
  label: string;
  value: string;
  trend: string;
  trendColor: string;
}

export interface DashboardBar {
  label: string;
  valueLabel: string;
  heightPct: number;
  color: string;
}

export interface DashboardLegend {
  label: string;
  pct: string;
  color: string;
}

export interface DashboardView {
  kpis: DashboardKpi[];
  monthlyBars: DashboardBar[];
  ratingLegend: DashboardLegend[];
  riskDonutStops: { color: string; from: number; to: number }[];
  activeDuplicatas: number;
  // Rótulo do que o donut e a legenda estão medindo — muda por papel (posições compradas
  // pro investidor, duplicatas emitidas pro cedente, recebidas pro sacado).
  donutTitle: string;
  monthlyTitle: string;
  // Quando não há nada a distribuir/somar, a UI mostra um aviso em vez de uma rosca vazia
  // ou de seis colunas de traço, que parecem um gráfico quebrado.
  donutEmptyHint: string | null;
  monthlyEmptyHint: string | null;
}

const MUTED = '#5B6472';
const EMPTY = '—';

function kpi(label: string, value: string, trend: string, trendColor = MUTED): DashboardKpi {
  return { label, value, trend, trendColor };
}

// Um KPI sem dado nenhum: traço + a razão, nunca R$ 0 (que significaria "seu resultado é
// zero", uma afirmação diferente e possivelmente falsa).
function emptyKpi(label: string, hint: string): DashboardKpi {
  return kpi(label, EMPTY, hint);
}

function pct(n: number): string {
  return n.toFixed(1).replace('.', ',') + '%';
}

// Distribuição real por rating, na mesma ordem/cor da legenda antiga (AA+A / B / C), mais
// uma faixa "Em análise" pro que ainda não tem score atribuído.
function buildRiskDistribution(items: { score: number | null; peso: number }[], donutTitle: string, emptyHint: string) {
  const total = items.reduce((s, i) => s + i.peso, 0);
  const buckets = { baixo: 0, moderado: 0, elevado: 0, analise: 0 };
  for (const i of items) {
    if (i.score === null) buckets.analise += i.peso;
    else {
      const r = ratingFromScore(i.score);
      if (r === 'AA' || r === 'A') buckets.baixo += i.peso;
      else if (r === 'B') buckets.moderado += i.peso;
      else buckets.elevado += i.peso;
    }
  }
  const share = (v: number) => (total > 0 ? (v / total) * 100 : 0);
  const parts = [
    { label: 'AA / A — baixo risco', value: share(buckets.baixo), color: COLORS.GREEN },
    { label: 'B — risco moderado', value: share(buckets.moderado), color: COLORS.AMBER },
    { label: 'C — risco elevado', value: share(buckets.elevado), color: COLORS.RED },
    { label: 'Em análise', value: share(buckets.analise), color: '#B8C2D4' },
  ];

  // Cortes acumulados: cada fatia começa onde a anterior terminou; a última fecha em 100
  // exatamente, pra arredondamento não deixar uma fresta branca no fim da rosca.
  const stops: { color: string; from: number; to: number }[] = [];
  let cursor = 0;
  parts.forEach((p, i) => {
    const to = i === parts.length - 1 ? 100 : cursor + p.value;
    stops.push({ color: p.color, from: cursor, to });
    cursor = to;
  });

  return {
    ratingLegend: parts.map((p) => ({ label: p.label, pct: pct(p.value), color: p.color })),
    riskDonutStops: total > 0 ? stops : [{ color: '#E4E8EE', from: 0, to: 100 }],
    donutTitle,
    donutEmptyHint: total > 0 ? null : emptyHint,
  };
}

// Últimos 6 meses (incluindo o atual), sempre 6 colunas mesmo que algum mês seja zero —
// um gráfico que muda de largura conforme o histórico confunde mais do que informa.
function buildMonthlyBars(
  events: { iso: string; valor: number }[],
  title: string,
  emptyHint: string
): { monthlyBars: DashboardBar[]; monthlyTitle: string; monthlyEmptyHint: string | null } {
  const now = new Date();
  const months: { key: string; label: string; total: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push({
      key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('pt-BR', { month: 'short', timeZone: 'UTC' }).replace('.', ''),
      total: 0,
    });
  }
  for (const e of events) {
    const key = e.iso.slice(0, 7);
    const m = months.find((x) => x.key === key);
    if (m) m.total += e.valor;
  }
  const max = Math.max(...months.map((m) => m.total));
  return {
    monthlyTitle: title,
    monthlyEmptyHint: max > 0 ? null : emptyHint,
    monthlyBars: months.map((m, i) => ({
      label: m.label,
      valueLabel: m.total > 0 ? fmtBRL(m.total) : EMPTY,
      heightPct: max > 0 ? Math.round((m.total / max) * 100) : 0,
      // O mês corrente (último) é destacado; os anteriores ficam em azul claro.
      color: i === months.length - 1 ? COLORS.BLUE : '#C7D6FF',
    })),
  };
}

function buildInvestidor(user: UserRow): DashboardView {
  const purchases = listPurchasesByInvestor(effectiveOwnerId(user));
  const investido = purchases.reduce((s, p) => s + precoPago(p), 0);
  const retorno = purchases.reduce((s, p) => s + p.retorno, 0);
  const abertas = purchases.filter((p) => p.active);

  const kpis = purchases.length === 0
    ? [
        emptyKpi('Total investido', 'nenhuma compra ainda'),
        emptyKpi('Retorno acumulado', 'nenhuma compra ainda'),
        emptyKpi('Rentabilidade acumulada', 'nenhuma compra ainda'),
        kpi('Posições abertas', '0', 'compre no marketplace para começar'),
      ]
    : [
        kpi('Total investido', fmtBRL(investido), `${purchases.length} ${purchases.length === 1 ? 'operação' : 'operações'}`),
        kpi('Retorno acumulado', fmtBRL(retorno), retorno > 0 ? 'ganho realizado + a realizar' : 'ainda sem ganho registrado', retorno > 0 ? COLORS.GREEN : MUTED),
        // Deliberadamente "acumulada", não "a.m.": é retorno sobre o investido no período
        // inteiro da carteira, não uma taxa mensal — ver README.
        investido > 0
          ? kpi('Rentabilidade acumulada', pct((retorno / investido) * 100), 'sobre o total investido')
          : emptyKpi('Rentabilidade acumulada', 'sem base de cálculo'),
        kpi('Posições abertas', String(abertas.length), abertas.length > 0 ? `${fmtBRL(abertas.reduce((s, p) => s + precoPago(p), 0))} alocados` : 'nenhuma posição em aberto'),
      ];

  return {
    kpis,
    activeDuplicatas: abertas.length,
    ...buildMonthlyBars(
      purchases.map((p) => ({ iso: toIsoUtc(p.created_at), valor: precoPago(p) })),
      'Investido por mês',
      'Nenhuma compra nos últimos 6 meses'
    ),
    ...buildRiskDistribution(
      abertas.map((p) => ({ score: p.score, peso: precoPago(p) })),
      'Carteira por rating',
      'Sem posições abertas para distribuir'
    ),
  };
}

function buildCedente(user: UserRow): DashboardView {
  const duplicatas = listByCedente(effectiveOwnerId(user));
  const antecipadas = duplicatas.filter((d) => d.status === 'vendida' || d.status === 'paga');
  const ativas = duplicatas.filter((d) => d.status === 'aprovada' || d.status === 'no_mercado');
  const totalAntecipado = antecipadas.reduce((s, d) => s + d.valor, 0);

  // Deságio real das que foram de fato antecipadas — a taxa que o cedente pagou, não a
  // estimativa de mercado de uma oferta que ninguém comprou.
  const taxas = antecipadas.map((d) => effectiveMonthlyRatePct(d));
  const prazos = duplicatas
    .map((d) => (parseFlexibleDate(d.vencimento).getTime() - parseFlexibleDate(d.emissao).getTime()) / 86_400_000)
    .filter((dias) => Number.isFinite(dias) && dias > 0);

  const kpis = [
    antecipadas.length > 0
      ? kpi('Total antecipado', fmtBRL(totalAntecipado), `${antecipadas.length} ${antecipadas.length === 1 ? 'duplicata' : 'duplicatas'} (valor de face)`)
      : emptyKpi('Total antecipado', 'nenhuma duplicata antecipada ainda'),
    taxas.length > 0
      ? kpi('Deságio médio pago', pct(taxas.reduce((s, t) => s + t, 0) / taxas.length) + ' a.m.', 'nas duplicatas antecipadas')
      : emptyKpi('Deságio médio pago', 'nenhuma duplicata antecipada ainda'),
    kpi('Duplicatas ativas', String(ativas.length), ativas.length > 0 ? 'aprovadas ou no mercado' : 'emita uma duplicata para começar'),
    prazos.length > 0
      ? kpi('Prazo médio', Math.round(prazos.reduce((s, p) => s + p, 0) / prazos.length) + ' dias', 'da emissão ao vencimento')
      : emptyKpi('Prazo médio', 'nenhuma duplicata emitida ainda'),
  ];

  return {
    kpis,
    activeDuplicatas: ativas.length,
    ...buildMonthlyBars(
      antecipadas.map((d) => ({ iso: toIsoUtc(d.created_at), valor: d.valor })),
      'Antecipado por mês',
      'Nenhuma antecipação nos últimos 6 meses'
    ),
    ...buildRiskDistribution(
      duplicatas.map((d) => ({ score: d.score, peso: d.valor })),
      'Suas duplicatas por rating',
      'Nenhuma duplicata emitida ainda'
    ),
  };
}

function buildSacado(user: UserRow): DashboardView {
  const duplicatas = listBySacadoNome(user.company_name);
  const aceites = listAceitesBySacadoNome(user.company_name);
  const aConfirmar = aceites.filter((a) => a.status === 'aguardando');
  const confirmadas = aceites.filter((a) => a.status === 'aceita');
  const emDisputa = aceites.filter((a) => a.status === 'contestada');

  const agora = Date.now();
  const aVencer = duplicatas.filter((d) => d.status !== 'paga' && parseFlexibleDate(d.vencimento).getTime() >= agora);
  const totalAVencer = aVencer.reduce((s, d) => s + d.valor, 0);

  const kpis = [
    kpi('Aceites a confirmar', String(aConfirmar.length), aConfirmar.length > 0 ? `${fmtBRL(aConfirmar.reduce((s, a) => s + a.valor, 0))} aguardando você` : 'nada pendente de confirmação'),
    aVencer.length > 0
      ? kpi('A vencer', fmtBRL(totalAVencer), `${aVencer.length} ${aVencer.length === 1 ? 'duplicata' : 'duplicatas'} em aberto`)
      : emptyKpi('A vencer', 'nenhuma duplicata em aberto'),
    confirmadas.length > 0
      ? kpi('Total confirmado', fmtBRL(confirmadas.reduce((s, a) => s + a.valor, 0)), `${confirmadas.length} ${confirmadas.length === 1 ? 'aceite' : 'aceites'} dado${confirmadas.length === 1 ? '' : 's'}`)
      : emptyKpi('Total confirmado', 'nenhum aceite confirmado ainda'),
    kpi('Disputas abertas', String(emDisputa.length), emDisputa.length > 0 ? 'aguardando resolução' : 'nenhuma contestação em aberto', emDisputa.length > 0 ? COLORS.AMBER : MUTED),
  ];

  return {
    kpis,
    activeDuplicatas: aVencer.length,
    ...buildMonthlyBars(
      duplicatas.map((d) => ({ iso: toIsoUtc(d.created_at), valor: d.valor })),
      'Duplicatas recebidas por mês',
      'Nenhuma duplicata recebida nos últimos 6 meses'
    ),
    ...buildRiskDistribution(
      duplicatas.map((d) => ({ score: d.score, peso: d.valor })),
      'Duplicatas contra você por rating',
      'Nenhuma duplicata registrada contra você'
    ),
  };
}

// Papéis sem carteira própria (admin, auditor, seguradora, api_partner, anunciante) não
// caem aqui na prática — nenhum deles tem a tab 'dashboard' em ROLE_TABS (data/seed.ts) —
// mas o dashboard responde a qualquer conta autenticada, então a visão de plataforma é o
// fallback honesto: números reais e agregados, sem fingir uma carteira que não existe.
function buildPlataforma(duplicatas: DuplicataRow[]): DashboardView {
  const ativas = duplicatas.filter((d) => d.status === 'aprovada' || d.status === 'no_mercado');
  const negociadas = duplicatas.filter((d) => d.status === 'vendida' || d.status === 'paga');
  const taxas = negociadas.map((d) => effectiveMonthlyRatePct(d));

  return {
    kpis: [
      negociadas.length > 0
        ? kpi('Volume negociado', fmtBRL(negociadas.reduce((s, d) => s + d.valor, 0)), `${negociadas.length} operações na plataforma`)
        : emptyKpi('Volume negociado', 'nenhuma operação concluída ainda'),
      taxas.length > 0
        ? kpi('Taxa média de mercado', pct(taxas.reduce((s, t) => s + t, 0) / taxas.length) + ' a.m.', 'nas operações concluídas')
        : emptyKpi('Taxa média de mercado', 'nenhuma operação concluída ainda'),
      kpi('Duplicatas ativas', String(ativas.length), 'aprovadas ou no mercado'),
      kpi('Duplicatas registradas', String(duplicatas.length), 'total na plataforma'),
    ],
    activeDuplicatas: ativas.length,
    ...buildMonthlyBars(
      negociadas.map((d) => ({ iso: toIsoUtc(d.created_at), valor: d.valor })),
      'Volume negociado por mês',
      'Nenhuma operação nos últimos 6 meses'
    ),
    ...buildRiskDistribution(
      duplicatas.map((d) => ({ score: d.score, peso: d.valor })),
      'Plataforma por rating',
      'Nenhuma duplicata registrada ainda'
    ),
  };
}

export function buildDashboard(user: UserRow, allDuplicatas: DuplicataRow[]): DashboardView {
  if (user.role === 'investidor') return buildInvestidor(user);
  if (user.role === 'cedente') return buildCedente(user);
  if (user.role === 'sacado') return buildSacado(user);
  return buildPlataforma(allDuplicatas);
}
