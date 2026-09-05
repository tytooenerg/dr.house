// Menu lateral agrupado por tarefa, não por "tipo de tela". Antes eram 3 grupos (Operações /
// Análise / Plataforma) e investidor e cedente viam 9 e 8 itens só em "Operações" — uma lista
// plana onde "Marketplace", "Linha de Crédito" e "Resolução de Disputas" ficavam lado a lado.
// Agora cada grupo responde a uma pergunta do usuário: onde eu opero, onde está meu dinheiro,
// onde está meu risco, onde configuro a plataforma. Nenhum grupo passa de 5 itens pra um
// papel real (ver navConfig.test.ts). "Início" é o grupo sem cabeçalho — só o dashboard.
//
// Quem pode ver cada tab continua sendo ROLE_TABS em server/src/data/seed.ts (vem em
// user.navTabs); aqui é só rótulo/rota/grupo — mesma disciplina de 4 pontas do CLAUDE.md.
export type NavGroup = 'inicio' | 'operacoes' | 'financeiro' | 'risco' | 'plataforma';

export interface NavItem {
  key: string;
  label: string;
  path: string;
  group: NavGroup;
}

// Ordem de exibição dos grupos e, dentro de cada grupo, a ordem de NAV_ITEMS.
export const NAV_GROUPS: NavGroup[] = ['inicio', 'operacoes', 'financeiro', 'risco', 'plataforma'];

export const GROUP_LABELS: Record<NavGroup, string> = {
  inicio: '',
  operacoes: 'Operações',
  financeiro: 'Financeiro',
  risco: 'Risco & Compliance',
  plataforma: 'Plataforma',
};

export const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: 'Visão Geral', path: '/app/dashboard', group: 'inicio' },

  // Operar: o que cada papel faz no dia a dia com duplicatas.
  { key: 'marketplace', label: 'Marketplace', path: '/app/marketplace', group: 'operacoes' },
  { key: 'secundario', label: 'Mercado Secundário', path: '/app/secundario', group: 'operacoes' },
  { key: 'cestas', label: 'Cestas de Investimento', path: '/app/cestas', group: 'operacoes' },
  { key: 'automacao', label: 'Automação de Lances', path: '/app/automacao', group: 'operacoes' },
  { key: 'emitir', label: 'Emitir Duplicata', path: '/app/emitir', group: 'operacoes' },
  { key: 'minhas', label: 'Minhas Duplicatas', path: '/app/minhas', group: 'operacoes' },
  { key: 'aceite', label: 'Aceite do Sacado', path: '/app/aceite', group: 'operacoes' },
  { key: 'erp', label: 'Integrações ERP', path: '/app/erp', group: 'operacoes' },
  { key: 'sacado', label: 'Portal do Sacado', path: '/app/sacado', group: 'operacoes' },
  { key: 'confirming', label: 'Programa Confirming', path: '/app/confirming', group: 'operacoes' },
  { key: 'seguradora', label: 'Painel da Seguradora', path: '/app/seguradora', group: 'operacoes' },

  // Financeiro: saldo, extrato, crédito, contas e a carteira consolidada.
  { key: 'conta', label: 'Conta & Liquidação', path: '/app/conta', group: 'financeiro' },
  { key: 'historico', label: 'Carteira & Histórico', path: '/app/historico', group: 'financeiro' },
  { key: 'linha-credito', label: 'Linha de Crédito', path: '/app/linha-credito', group: 'financeiro' },
  { key: 'contas-pagar', label: 'Contas a Pagar', path: '/app/contas-pagar', group: 'financeiro' },
  { key: 'ai-cfo', label: 'AI CFO', path: '/app/ai-cfo', group: 'financeiro' },

  // Risco & Compliance: análise, perfil, comparação de taxa, obrigações e disputas.
  { key: 'risco', label: 'Análise de Risco', path: '/app/risco', group: 'risco' },
  { key: 'suitability', label: 'Perfil de Investidor', path: '/app/suitability', group: 'risco' },
  { key: 'comparador', label: 'Comparador de Taxas', path: '/app/comparador', group: 'risco' },
  { key: 'compliance', label: 'Compliance', path: '/app/compliance', group: 'risco' },
  { key: 'disputa', label: 'Resolução de Disputas', path: '/app/disputa', group: 'risco' },

  // Plataforma: integração, painéis de papéis de suporte, plano e configurações.
  { key: 'dev', label: 'Desenvolvedores', path: '/app/dev', group: 'plataforma' },
  { key: 'publicidade', label: 'Publicidade', path: '/app/publicidade', group: 'plataforma' },
  { key: 'admin', label: 'Back-office', path: '/app/admin', group: 'plataforma' },
  { key: 'auditor', label: 'Painel de Auditoria', path: '/app/auditor', group: 'plataforma' },
  { key: 'receita', label: 'Modelo de Receita', path: '/app/receita', group: 'plataforma' },
  { key: 'assinatura', label: 'Assinatura', path: '/app/assinatura', group: 'plataforma' },
  { key: 'perfil', label: 'Perfil & Configurações', path: '/app/perfil', group: 'plataforma' },
];

export const DEFAULT_TAB_BY_ROLE: Record<string, string> = {
  investidor: 'dashboard',
  cedente: 'minhas',
  sacado: 'sacado',
  admin: 'admin',
  seguradora: 'seguradora',
  auditor: 'auditor',
  api_partner: 'dev',
  anunciante: 'publicidade',
};

export interface NavSection {
  group: NavGroup;
  label: string;
  items: NavItem[];
}

// Grupos na ordem de NAV_GROUPS, só com os itens que o papel pode ver; grupos vazios somem.
export function groupNavItems(allowedKeys: Iterable<string>): NavSection[] {
  const allowed = new Set(allowedKeys);
  return NAV_GROUPS.map((group) => ({
    group,
    label: GROUP_LABELS[group],
    items: NAV_ITEMS.filter((i) => i.group === group && allowed.has(i.key)),
  })).filter((s) => s.items.length > 0);
}

// Item cujo path é o prefixo (por segmento) da rota atual — /app/admin/kyb resolve pra
// "Back-office"; /app/contas-pagar NÃO resolve pra "Conta & Liquidação" (/app/conta).
export function findNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((i) => pathname === i.path || pathname.startsWith(i.path + '/'));
}
