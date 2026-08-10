export interface NavItem {
  key: string;
  label: string;
  path: string;
  group: 'operacoes' | 'analise' | 'plataforma';
}

export const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: 'Visão Geral', path: '/app/dashboard', group: 'operacoes' },
  { key: 'marketplace', label: 'Marketplace', path: '/app/marketplace', group: 'operacoes' },
  { key: 'automacao', label: 'Automação de Lances', path: '/app/automacao', group: 'operacoes' },
  { key: 'erp', label: 'Integrações ERP', path: '/app/erp', group: 'operacoes' },
  { key: 'emitir', label: 'Emitir Duplicata', path: '/app/emitir', group: 'operacoes' },
  { key: 'minhas', label: 'Minhas Duplicatas', path: '/app/minhas', group: 'operacoes' },
  { key: 'linha-credito', label: 'Linha de Crédito', path: '/app/linha-credito', group: 'operacoes' },
  { key: 'secundario', label: 'Mercado Secundário', path: '/app/secundario', group: 'operacoes' },
  { key: 'cestas', label: 'Cestas de Investimento', path: '/app/cestas', group: 'operacoes' },
  { key: 'suitability', label: 'Perfil de Investidor', path: '/app/suitability', group: 'operacoes' },
  { key: 'aceite', label: 'Aceite do Sacado', path: '/app/aceite', group: 'operacoes' },
  { key: 'sacado', label: 'Portal do Sacado', path: '/app/sacado', group: 'operacoes' },
  { key: 'disputa', label: 'Resolução de Disputas', path: '/app/disputa', group: 'operacoes' },
  { key: 'risco', label: 'Análise de Risco', path: '/app/risco', group: 'analise' },
  { key: 'historico', label: 'Carteira & Histórico', path: '/app/historico', group: 'analise' },
  { key: 'comparador', label: 'Comparador de Taxas', path: '/app/comparador', group: 'analise' },
  { key: 'compliance', label: 'Compliance', path: '/app/compliance', group: 'plataforma' },
  { key: 'dev', label: 'Desenvolvedores', path: '/app/dev', group: 'plataforma' },
  { key: 'conta', label: 'Conta & Liquidação', path: '/app/conta', group: 'plataforma' },
  { key: 'receita', label: 'Modelo de Receita', path: '/app/receita', group: 'plataforma' },
  { key: 'assinatura', label: 'Assinatura', path: '/app/assinatura', group: 'plataforma' },
  { key: 'perfil', label: 'Perfil & Configurações', path: '/app/perfil', group: 'plataforma' },
  { key: 'admin', label: 'Back-office', path: '/app/admin', group: 'plataforma' },
  { key: 'seguradora', label: 'Painel da Seguradora', path: '/app/seguradora', group: 'operacoes' },
];

export const GROUP_LABELS: Record<string, string> = {
  operacoes: 'Operações',
  analise: 'Análise',
  plataforma: 'Plataforma',
};

export const DEFAULT_TAB_BY_ROLE: Record<string, string> = {
  investidor: 'dashboard',
  cedente: 'minhas',
  sacado: 'sacado',
  admin: 'admin',
  seguradora: 'seguradora',
};
