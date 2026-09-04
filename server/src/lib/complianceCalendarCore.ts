import { getSettings, listUsersByRole } from '../db/users.js';
import { COLORS } from '../data/seed.js';
import type { FaturamentoBracket, UserRow } from '../db/types.js';

export type { FaturamentoBracket };

export const FATURAMENTO_BRACKET_LABELS: Record<FaturamentoBracket, string> = {
  acima_300m: 'Acima de R$ 300 milhões/ano',
  entre_90m_300m: 'Entre R$ 90 milhões e R$ 300 milhões/ano',
  entre_4_8m_90m: 'Entre R$ 4,8 milhões e R$ 90 milhões/ano',
  ate_4_8m: 'Até R$ 4,8 milhões/ano',
};

export const PRODUCAO_ASSISTIDA_INICIO = new Date('2026-07-01T00:00:00Z');

// Datas aproximadas do cronograma de fases do Banco Central para a duplicata escritural
// (adesão voluntária desde jul/2026, obrigatoriedade escalonada por faturamento anual até
// ~2028) — não é uma citação literal de um normativo específico, e o BC já ajustou prazos
// de outras iniciativas antes (ex.: Pix em Garantia, adiado pra 2027). Um humano deve
// revisar/atualizar estas datas quando o BC publicar ou alterar o cronograma oficial. Isso
// não é uma integração externa — não existe uma API do BCB pra isso — é conhecimento
// regulatório estático, mantido manualmente, no mesmo espírito honesto de SECTOR_KEYWORDS
// em riscoCore.ts: um valor real e citável, nunca um número inventado pra parecer preciso.
export const OBRIGATORIEDADE_POR_BRACKET: Record<FaturamentoBracket, Date> = {
  acima_300m: new Date('2026-12-31T00:00:00Z'),
  entre_90m_300m: new Date('2027-03-31T00:00:00Z'),
  entre_4_8m_90m: new Date('2027-09-30T00:00:00Z'),
  ate_4_8m: new Date('2028-06-30T00:00:00Z'),
};

export type ComplianceCalendarStatus = 'nao_informado' | 'assistida_disponivel' | 'obrigatorio_pleno';

export interface ComplianceCalendarView {
  bracket: FaturamentoBracket | null;
  bracketLabel: string | null;
  status: ComplianceCalendarStatus;
  statusLabel: string;
  obrigatorioEmFmt: string | null;
  diasRestantes: number | null;
  producaoAssistidaDisponivelDesdeFmt: string;
}

function fmtDateBR(d: Date): string {
  return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

function daysBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24)));
}

export function classifyCompliance(bracket: FaturamentoBracket | null, today: Date = new Date()): ComplianceCalendarView {
  const producaoAssistidaDisponivelDesdeFmt = fmtDateBR(PRODUCAO_ASSISTIDA_INICIO);
  if (bracket === null) {
    return {
      bracket: null,
      bracketLabel: null,
      status: 'nao_informado',
      statusLabel: 'Informe a faixa de faturamento anual da sua empresa para ver seu prazo de obrigatoriedade.',
      obrigatorioEmFmt: null,
      diasRestantes: null,
      producaoAssistidaDisponivelDesdeFmt,
    };
  }
  const obrigatorioEm = OBRIGATORIEDADE_POR_BRACKET[bracket];
  const obrigatorioEmFmt = fmtDateBR(obrigatorioEm);
  if (today.getTime() < obrigatorioEm.getTime()) {
    return {
      bracket,
      bracketLabel: FATURAMENTO_BRACKET_LABELS[bracket],
      status: 'assistida_disponivel',
      statusLabel: `Produção assistida disponível — obrigatório a partir de ${obrigatorioEmFmt}.`,
      obrigatorioEmFmt,
      diasRestantes: daysBetween(obrigatorioEm, today),
      producaoAssistidaDisponivelDesdeFmt,
    };
  }
  return {
    bracket,
    bracketLabel: FATURAMENTO_BRACKET_LABELS[bracket],
    status: 'obrigatorio_pleno',
    statusLabel: `Já em regime pleno desde ${obrigatorioEmFmt}.`,
    obrigatorioEmFmt,
    diasRestantes: 0,
    producaoAssistidaDisponivelDesdeFmt,
  };
}

export function buildComplianceCalendarView(user: UserRow, today: Date = new Date()): ComplianceCalendarView {
  return classifyCompliance(getSettings(user).faturamentoAnualBracket, today);
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
function fmtMesAno(d: Date): string {
  return `${MESES[d.getUTCMonth()]}/${d.getUTCFullYear()}`;
}

export interface CronogramaItem {
  label: string;
  periodo: string;
  status: string;
  statusBg: string;
  statusColor: string;
  dotColor: string;
}

// Achado corrigido (auditoria de conformidade): esta lista costumava ser mantida à parte,
// como um array estático em data/seed.ts (3 estágios, datas vagas — "A partir do fim de
// 2026", "Ao longo de 2027") — uma segunda fonte de verdade pro mesmo fato regulatório que
// OBRIGATORIEDADE_POR_BRACKET acima já modela com precisão, e as duas podiam divergir. Um
// cedente lendo o card estático do Compliance e o próprio calendário pessoal
// (buildComplianceCalendarView) podia ver dois prazos diferentes pro mesmo evento. Agora é
// gerada dinamicamente a partir das MESMAS constantes — nunca mais duas fontes.
export function buildCronogramaEstatico(today: Date = new Date()): CronogramaItem[] {
  const adesaoAtiva = today.getTime() >= PRODUCAO_ASSISTIDA_INICIO.getTime();
  const items: CronogramaItem[] = [
    {
      label: 'Adesão voluntária',
      periodo: `Desde ${fmtMesAno(PRODUCAO_ASSISTIDA_INICIO)} — sacadores e sacados podem aderir`,
      status: adesaoAtiva ? 'Ativo' : 'Planejado',
      statusBg: adesaoAtiva ? '#EAF3EE' : '#FBF1E0',
      statusColor: adesaoAtiva ? COLORS.GREEN : COLORS.AMBER,
      dotColor: adesaoAtiva ? COLORS.GREEN : COLORS.AMBER,
    },
  ];
  // Ordenado por data (a própria ordem de definição do Record já é cronológica), e o
  // primeiro prazo futuro (a próxima obrigatoriedade a valer) fica em âmbar — os demais,
  // mais distantes, em cinza — mesmo esquema visual que o array estático usava.
  let proximoFuturoJaMarcado = false;
  for (const bracket of Object.keys(OBRIGATORIEDADE_POR_BRACKET) as FaturamentoBracket[]) {
    const data = OBRIGATORIEDADE_POR_BRACKET[bracket];
    const ativo = today.getTime() >= data.getTime();
    const ehProximoFuturo = !ativo && !proximoFuturoJaMarcado;
    if (!ativo) proximoFuturoJaMarcado = true;
    items.push({
      label: `Obrigatoriedade — ${FATURAMENTO_BRACKET_LABELS[bracket]}`,
      periodo: `A partir de ${fmtMesAno(data)}`,
      status: ativo ? 'Ativo' : 'Planejado',
      statusBg: ativo ? '#EAF3EE' : ehProximoFuturo ? '#FBF1E0' : '#F0F2F5',
      statusColor: ativo ? COLORS.GREEN : ehProximoFuturo ? COLORS.AMBER : '#5B6472',
      dotColor: ativo ? COLORS.GREEN : ehProximoFuturo ? COLORS.AMBER : '#B8C2D4',
    });
  }
  return items;
}

export interface ComplianceCalendarAdminRow extends ComplianceCalendarView {
  userId: number;
  companyName: string;
  role: 'cedente' | 'sacado';
  email: string;
}

export interface ComplianceCalendarSummary {
  rows: ComplianceCalendarAdminRow[];
  countsByStatus: Record<ComplianceCalendarStatus, number>;
}

// Visão de oversight do admin — não filtra em SQL porque o volume de cedentes/sacados é
// baixo o bastante (mesma premissa de listActiveCedentes/listActiveInvestidores) pra
// classificar tudo em memória, sem precisar de uma coluna indexável nova em `users`.
export function listComplianceCalendarSummary(): ComplianceCalendarSummary {
  const countsByStatus: Record<ComplianceCalendarStatus, number> = { nao_informado: 0, assistida_disponivel: 0, obrigatorio_pleno: 0 };
  const rows: ComplianceCalendarAdminRow[] = [];
  for (const role of ['cedente', 'sacado'] as const) {
    for (const user of listUsersByRole(role)) {
      const view = buildComplianceCalendarView(user);
      countsByStatus[view.status]++;
      rows.push({ ...view, userId: user.id, companyName: user.company_name, role, email: user.email });
    }
  }
  return { rows, countsByStatus };
}
