// Seed data extracted from the Lastro design handoff prototype (Lastro Dashboard.dc.html).

export const COLORS = {
  BLUE: '#1E5EFF',
  NAVY: '#0B1F3A',
  GREEN: '#0A5C36',
  AMBER: '#B8790A',
  RED: '#B03A2E',
};

export type Rating = 'AA' | 'A' | 'B' | 'C';

export interface SacadoFactor {
  label: string;
  value: string;
  barPct: string;
  barColor: string;
}

export interface Sacado {
  score: number;
  rating: Rating;
  trend: 'up' | 'down' | 'stable';
  trendDelta: string;
  pd12m: string;
  alerta: string | null;
  factors: SacadoFactor[];
}

export const SACADOS: Record<string, Sacado> = {
  'Grupo Atlas Varejo': {
    score: 84,
    rating: 'AA',
    trend: 'up',
    trendDelta: '+3 nos últimos 90 dias',
    pd12m: '0,8%',
    alerta: null,
    factors: [
      { label: 'Histórico de pagamento', value: 'Excelente', barPct: '92%', barColor: COLORS.GREEN },
      { label: 'Protestos (24m)', value: '0 ocorrências', barPct: '95%', barColor: COLORS.GREEN },
      { label: 'Concentração setorial', value: 'Varejo — moderado', barPct: '58%', barColor: COLORS.AMBER },
      { label: 'Endividamento', value: 'Baixo', barPct: '80%', barColor: COLORS.GREEN },
    ],
  },
  'Metalúrgica Serrana S.A.': {
    score: 61,
    rating: 'B',
    trend: 'down',
    trendDelta: '-6 nos últimos 90 dias',
    pd12m: '4,1%',
    alerta: 'Modelo preditivo detectou aumento de 15% no prazo médio de pagamento nas últimas 3 faturas — atenção a atraso.',
    factors: [
      { label: 'Histórico de pagamento', value: 'Regular, 2 atrasos', barPct: '58%', barColor: COLORS.AMBER },
      { label: 'Protestos (24m)', value: '1 ocorrência', barPct: '55%', barColor: COLORS.AMBER },
      { label: 'Concentração setorial', value: 'Industrial — alto', barPct: '40%', barColor: COLORS.AMBER },
      { label: 'Endividamento', value: 'Moderado', barPct: '52%', barColor: COLORS.AMBER },
    ],
  },
  'Construtora Vale Norte': {
    score: 38,
    rating: 'C',
    trend: 'down',
    trendDelta: '-11 nos últimos 90 dias',
    pd12m: '9,7%',
    alerta: 'Tendência de cancelamento acima do normal — 2 faturas recentes com renegociação de prazo.',
    factors: [
      { label: 'Histórico de pagamento', value: '4 atrasos recentes', barPct: '30%', barColor: COLORS.RED },
      { label: 'Protestos (24m)', value: '3 ocorrências', barPct: '22%', barColor: COLORS.RED },
      { label: 'Concentração setorial', value: 'Construção — alto', barPct: '35%', barColor: COLORS.RED },
      { label: 'Endividamento', value: 'Elevado', barPct: '28%', barColor: COLORS.RED },
    ],
  },
  'Distribuidora Bom Preço': {
    score: 76,
    rating: 'A',
    trend: 'stable',
    trendDelta: 'estável nos últimos 90 dias',
    pd12m: '1,4%',
    alerta: null,
    factors: [
      { label: 'Histórico de pagamento', value: 'Bom, 1 atraso leve', barPct: '78%', barColor: COLORS.GREEN },
      { label: 'Protestos (24m)', value: '0 ocorrências', barPct: '90%', barColor: COLORS.GREEN },
      { label: 'Concentração setorial', value: 'Alimentício — baixo', barPct: '70%', barColor: COLORS.GREEN },
      { label: 'Endividamento', value: 'Baixo', barPct: '75%', barColor: COLORS.GREEN },
    ],
  },
};

export const INSURERS = [
  { key: 'too', name: 'Too Seguros', premioPct: 0.55, premioFmt: '0,55%', selo: 'Parceira desde 2024' },
  { key: 'pottencial', name: 'Pottencial Seguradora', premioPct: 0.6, premioFmt: '0,60%', selo: 'Maior cobertura de sinistro' },
  { key: 'junto', name: 'Junto Seguros', premioPct: 0.68, premioFmt: '0,68%', selo: 'Aprovação mais rápida' },
];

export const OFFERS_RAW = [
  { id: 1, sacado: 'Grupo Atlas Varejo', cedente: 'Fornecedor Lima Ltda', valor: 84500, desagio: '2,1%', vencimento: '12/08/2026', score: 84, countdownSec: 6120 },
  { id: 2, sacado: 'Distribuidora Bom Preço', cedente: 'Indústria Nova Era', valor: 46200, desagio: '2,4%', vencimento: '05/09/2026', score: 76, countdownSec: 11100 },
  { id: 3, sacado: 'Metalúrgica Serrana S.A.', cedente: 'Aços Regional', valor: 132000, desagio: '3,6%', vencimento: '20/08/2026', score: 61, countdownSec: 1080 },
  { id: 4, sacado: 'Construtora Vale Norte', cedente: 'Materiais Cimento Sul', valor: 210000, desagio: '5,2%', vencimento: '02/10/2026', score: 38, countdownSec: 21000 },
  { id: 5, sacado: 'Grupo Atlas Varejo', cedente: 'Têxtil Bandeira', valor: 31800, desagio: '2,0%', vencimento: '28/07/2026', score: 84, countdownSec: 7920 },
  { id: 6, sacado: 'Distribuidora Bom Preço', cedente: 'Embalagens Prisma', valor: 58900, desagio: '2,6%', vencimento: '15/09/2026', score: 76, countdownSec: 16020 },
];

export const ACEITE_MAP: Record<number, 'aceita' | 'aguardando' | 'contestada'> = {
  1: 'aceita', 2: 'aguardando', 3: 'aceita', 4: 'contestada', 5: 'aceita', 6: 'aguardando',
};

export const BID_TEMPLATES = [
  { name: 'Itaú BBA Recebíveis', initials: 'IB', tipo: 'Banco', avatarBg: COLORS.NAVY },
  { name: 'FIDC Multisetorial Prisma', initials: 'FP', tipo: 'FIDC', avatarBg: COLORS.BLUE },
  { name: 'Vórtice Crédito', initials: 'VC', tipo: 'Fintech', avatarBg: '#5B6472' },
  { name: 'Nortis Investimentos', initials: 'NI', tipo: 'Family Office', avatarBg: COLORS.GREEN },
];

export const EXTRA_BIDDERS = [
  { name: 'BTG Pactual Crédito', initials: 'BP', tipo: 'Banco', avatarBg: COLORS.NAVY },
  { name: 'Kayrós FIDC', initials: 'KF', tipo: 'FIDC', avatarBg: COLORS.BLUE },
  { name: 'Zenit Capital', initials: 'ZC', tipo: 'Fintech', avatarBg: '#5B6472' },
  { name: 'Bradesco Corporate', initials: 'BC', tipo: 'Banco', avatarBg: COLORS.NAVY },
];

export const MINHAS_RAW = [
  { id: 'm1', sacado: 'Grupo Atlas Varejo', valor: 84500, emissao: '10/06/2026', vencimento: '12/08/2026', status: 'No mercado', lastro: 100 },
  { id: 'm2', sacado: 'Padaria Central Ltda', valor: 12300, emissao: '02/07/2026', vencimento: '30/07/2026', status: 'Pendente análise', lastro: 40 },
  { id: 'm3', sacado: 'Distribuidora Bom Preço', valor: 46200, emissao: '18/05/2026', vencimento: '05/09/2026', status: 'No mercado', lastro: 100 },
  { id: 'm4', sacado: 'Auto Peças Rio', valor: 9800, emissao: '22/04/2026', vencimento: '22/06/2026', status: 'Paga', lastro: 100 },
  { id: 'm5', sacado: 'Metalúrgica Serrana S.A.', valor: 132000, emissao: '30/06/2026', vencimento: '20/08/2026', status: 'Aprovada', lastro: 80 },
];

export const HISTORICO_RAW = [
  { data: '02/07/2026', empresa: 'Grupo Atlas Varejo', investido: 40000, retorno: 1520 },
  { data: '18/06/2026', empresa: 'Distribuidora Bom Preço', investido: 22000, retorno: 780 },
  { data: '30/05/2026', empresa: 'Auto Peças Rio', investido: 9800, retorno: 340 },
  { data: '14/05/2026', empresa: 'Farmácias União', investido: 61000, retorno: 2190 },
  { data: '02/05/2026', empresa: 'Grupo Atlas Varejo', investido: 35400, retorno: 1280 },
  { data: '20/04/2026', empresa: 'Distribuidora Bom Preço', investido: 18000, retorno: 610 },
];

export const ACEITES_RAW = [
  { id: 1, duplicataId: 'DUP-2026-0842', sacado: 'Grupo Atlas Varejo', valor: 84500, prazo: '3 dias úteis restantes' },
  { id: 2, duplicataId: 'DUP-2026-0791', sacado: 'Metalúrgica Serrana S.A.', valor: 132000, prazo: 'Prazo expirado — aceite tácito' },
  { id: 3, duplicataId: 'DUP-2026-0765', sacado: 'Distribuidora Bom Preço', valor: 46200, prazo: '7 dias úteis restantes' },
  { id: 4, duplicataId: 'DUP-2026-0733', sacado: 'Construtora Vale Norte', valor: 210000, prazo: '1 dia útil restante' },
];

export const DISPUTE_MOTIVOS: Record<number, string> = {
  2: 'Sacado alega que parte da mercadoria foi devolvida e o valor da fatura está incorreto.',
};

export const DISPUTE_TIMELINES: Record<number, { autor: string; texto: string; quando: string }[]> = {
  2: [{ autor: 'Metalúrgica Serrana S.A.', texto: 'Contestou o valor — nota de devolução parcial anexada.', quando: 'há 2 dias' }],
};

export const KPIS_RAW = [
  { label: 'Total antecipado', value: 'R$ 128,4M', trend: '+12,4% vs. mês anterior', trendColor: COLORS.GREEN },
  { label: 'Taxa média de deságio', value: '2,3% a.m.', trend: '-0,2 p.p. vs. mês anterior', trendColor: COLORS.GREEN },
  { label: 'Duplicatas ativas', value: '342', trend: '+28 novas esta semana', trendColor: COLORS.GREEN },
  { label: 'Rendimento médio investidor', value: '1,8% a.m.', trend: 'estável', trendColor: '#5B6472' },
];

export const MONTHS_RAW = [
  { label: 'Fev', v: 14.2 }, { label: 'Mar', v: 16.8 }, { label: 'Abr', v: 15.1 },
  { label: 'Mai', v: 19.4 }, { label: 'Jun', v: 22.7 }, { label: 'Jul', v: 24.3 },
];

export const RATING_LEGEND = [
  { label: 'AA / A — baixo risco', pct: '58%', color: COLORS.GREEN },
  { label: 'B — risco moderado', pct: '27%', color: COLORS.AMBER },
  { label: 'C — risco elevado', pct: '11%', color: COLORS.RED },
  { label: 'Em análise', pct: '4%', color: '#B8C2D4' },
];

export const NOTIFICATIONS = [
  { text: 'Leilão da duplicata #3 (Metalúrgica Serrana) encerra em 18 min', time: 'agora', color: COLORS.RED },
  { text: 'Grupo Atlas Varejo aceitou a duplicata DUP-2026-0842', time: 'há 20 min', color: COLORS.GREEN },
  { text: 'Nova oferta compatível com seu perfil: Distribuidora Bom Preço, 2,6% a.m.', time: 'há 1 h', color: COLORS.BLUE },
  { text: 'Duplicata #2 vence em 5 dias', time: 'há 3 h', color: COLORS.AMBER },
];

export const RATE_CHANNELS = [
  { label: 'Marketplace com leilão', isLastro: true, rangeLabel: '1,8% – 2,6% a.m.', leftPct: 4, widthPct: 14, barColor: COLORS.BLUE },
  { label: 'Fintech direta (balanço próprio)', isLastro: false, rangeLabel: '3,0% – 5,0% a.m.', leftPct: 18, widthPct: 20, barColor: '#8FA8E8' },
  { label: 'FIDC / factoring tradicional', isLastro: false, rangeLabel: '3,5% – 6,0% a.m.', leftPct: 22, widthPct: 24, barColor: '#B8C2D4' },
  { label: 'Banco / programa do comprador', isLastro: false, rangeLabel: '4,5% – 8,0% a.m.', leftPct: 30, widthPct: 32, barColor: '#D6DCE5' },
];

export const TRUST_BRIDGE = [
  { parte: 'Empresas (cedentes)', veSobreo: 'Status de aceite do sacado e histórico de negociação em tempo real, sem depender de um único banco.' },
  { parte: 'Bancos e fundos', veSobreo: 'Score do sacado, aceite confirmado e estágio de provisionamento antes de comprar — due diligence pronta.' },
  { parte: 'Sacados', veSobreo: 'A duplicata antes de virar garantia, com prazo claro para aceitar ou contestar.' },
  { parte: 'Banco Central', veSobreo: 'Trilha de auditoria e registro único em CERC, B3 e Núclea — sem duplicidade possível.' },
];

export const FINANCIADOR_REQS = [
  { label: 'Duplicata escritural obrigatória', desc: 'Bancos só podem negociar recebíveis mercantis em formato escritural — prazo escalonado por porte: 180 dias (grande empresa), 360 dias (média) e 540 dias (pequena) após a interoperabilidade plena.', color: COLORS.BLUE },
  { label: 'Previsão contratual da emissão', desc: 'Em recebíveis a constituir, o contrato deve prever a obrigatoriedade de emitir a duplicata escritural no momento da venda, com as condições de liberação dos recursos.', color: COLORS.BLUE },
  { label: 'Prova de integração técnica', desc: 'O financiador mantém por 5 anos a documentação de testes de integração com as registradoras/depositárias, à disposição do Banco Central.', color: COLORS.AMBER },
  { label: 'Baixa de gravames', desc: 'Ao quitar a operação, a instituição deve desconstituir gravames e ônus remanescentes sobre a duplicata usada como garantia.', color: COLORS.AMBER },
  { label: 'Aceite ou manifestação do sacado', desc: 'Apresentação em até 2 dias úteis da emissão; o sacado tem até 10 dias para recusar ou 15 para aceitar — sem isso, a validade plena fica em risco.', color: COLORS.RED },
  { label: 'Lastro documental completo', desc: 'Contrato, pedido, nota fiscal, entrega, aceite, vencimento e histórico de pagamento precisam estar documentados para o banco aceitar o título.', color: COLORS.RED },
  { label: 'Provisionamento por estágio de risco', desc: 'Segue a Res. CMN 4.966: Estágio 1 (normal), Estágio 2 (atraso >30 dias, provisão integral do contrato) e Estágio 3 (atraso >90 dias, provisão total), com modelos de PD/LGD/EAD.', color: COLORS.GREEN },
];

export const CRONOGRAMA = [
  { label: 'Adesão voluntária', periodo: 'Desde jul/2026 — sacadores e sacados podem aderir', status: 'Ativo', statusBg: '#EAF3EE', statusColor: COLORS.GREEN, dotColor: COLORS.GREEN },
  { label: 'Obrigatoriedade — grandes empresas', periodo: 'A partir do fim de 2026', status: 'Planejado', statusBg: '#FBF1E0', statusColor: COLORS.AMBER, dotColor: COLORS.AMBER },
  { label: 'Obrigatoriedade — médias e pequenas empresas', periodo: 'Ao longo de 2027', status: 'Planejado', statusBg: '#F0F2F5', statusColor: '#5B6472', dotColor: '#B8C2D4' },
];

export const AUDIT_LOG = [
  { timestamp: '08/07/2026 09:14', ator: 'Marina Costa', acao: 'Comprou duplicata #1 — Grupo Atlas Varejo' },
  { timestamp: '07/07/2026 17:02', ator: 'Sistema', acao: 'Registro escritural confirmado na CERC — ESC-2026-084112' },
  { timestamp: '07/07/2026 16:58', ator: 'Padaria Central Ltda', acao: 'Emitiu duplicata e enviou para análise' },
  { timestamp: '06/07/2026 11:30', ator: 'Sistema', acao: 'Consulta de duplicidade — nenhuma ocorrência (CERC/B3/Núclea)' },
  { timestamp: '05/07/2026 08:45', ator: 'Marina Costa', acao: 'Contratou seguro sobre duplicata #3' },
];

export const FRAUD_FLAGS = [
  { text: '342 duplicatas escaneadas nas últimas 24h — 0 anomalias críticas', color: COLORS.GREEN },
  { text: '1 duplicata sinalizada por valor 3x acima da média histórica do sacado', color: COLORS.AMBER },
  { text: 'Nenhuma reutilização de NF-e detectada entre operações', color: COLORS.GREEN },
];

export const CONTRACT_FLAGS = [
  { text: '5 contratos de cessão analisados este mês', color: COLORS.GREEN },
  { text: '1 cláusula de exclusividade incompatível encontrada — sinalizada para revisão jurídica', color: COLORS.AMBER },
  { text: 'Nenhuma cláusula de vedação à cessão identificada nos demais', color: COLORS.GREEN },
];

export const REV_COLORS = [COLORS.BLUE, '#0A5C36', '#B8790A', '#7C5CFF', '#5B6472', '#4C8CFF', '#0B1F3A', '#D97757', '#2A6FDB', '#8B97AC', '#1F8A5B', '#A63D5A'];

export const REVENUE_RAW = [
  { label: 'Taxa de plataforma', desc: '0,35% sobre o valor de cada operação, descontada na liquidação', valor: 449.8 },
  { label: 'Spread do leilão', desc: 'Diferença entre a taxa paga pelo financiador e a recebida pelo cedente', valor: 312.4 },
  { label: 'Comissão de seguro', desc: 'Seguro 100% terceirizado com seguradora parceira — a Lastro recebe comissão de distribuição, sem assumir risco de sinistro', valor: 156.9 },
  { label: 'Taxa de API / integração', desc: 'Cobrança por volume processado para ERPs e fintechs parceiras', valor: 118.2 },
  { label: 'Assinatura institucional', desc: 'Plano para investidores com analytics avançado e maior limite de API', valor: 84.6 },
  { label: 'Float de liquidação', desc: 'Rendimento sobre o saldo em trânsito entre D+0 e D+1', valor: 52.3 },
  { label: 'Score de crédito (API avulsa)', desc: 'Venda da API de risco do sacado para quem não usa o marketplace — bancos, seguradoras e fintechs fora do marketplace', valor: 31.5 },
  { label: 'Selo de conformidade', desc: 'Certificação "Duplicata verificada Lastro" para empresas usarem em negociações fora da plataforma', valor: 22.4 },
  { label: 'Programa de afiliados', desc: 'Contadores, ERPs e consultorias indicam clientes e recebem comissão recorrente sobre o volume trazido', valor: 27.8 },
  { label: 'Dados e benchmarking', desc: 'Relatórios anonimizados de tendência de deságio por setor/região vendidos a fundos e associações', valor: 18.6 },
  { label: 'Setup de integração customizada', desc: 'Implementação sob medida cobrada de grandes empresas com ERPs não padronizados', valor: 34.2 },
  { label: 'Risco sacado reverso', desc: 'Sacado financia pagamento antecipado a fornecedores pequenos com linha própria — fee de operação sobre o fluxo invertido', valor: 41.7 },
];

export const ERP_CONNECTORS_META = [
  { key: 'sap', name: 'SAP', desc: 'Vendas viram duplicatas escriturais automaticamente a cada faturamento.' },
  { key: 'totvs', name: 'TOTVS', desc: 'Sincronização em tempo real com o módulo financeiro/contas a receber.' },
  { key: 'omie', name: 'Omie', desc: 'Ideal para pequenas e médias empresas — conexão em poucos cliques.' },
];

export const TEAM_MEMBERS = [
  { nome: 'Marina Costa', email: 'marina.costa@empresa.com.br', papel: 'Administrador' },
  { nome: 'Rafael Nunes', email: 'rafael.nunes@empresa.com.br', papel: 'Financeiro' },
  { nome: 'Juliana Prado', email: 'juliana.prado@empresa.com.br', papel: 'Somente leitura' },
];

export const EXTRATO_RAW = [
  { data: '08/07/2026', descricao: 'Liquidação — Grupo Atlas Varejo (DUP-2026-0842)', valor: 84204.25 },
  { data: '07/07/2026', descricao: 'Taxa de plataforma retida', valor: -295.75 },
  { data: '05/07/2026', descricao: 'Compra de duplicata — Distribuidora Bom Preço', valor: -46200.0 },
  { data: '02/07/2026', descricao: 'Retorno de operação concluída', valor: 1520.0 },
  { data: '28/06/2026', descricao: 'Depósito para liquidação futura', valor: 50000.0 },
];

export const WEBHOOK_EVENTS = ['duplicata.registrada', 'leilao.aberto', 'lance.recebido', 'leilao.encerrado', 'pagamento.confirmado'];

export const CHAT_SUGGESTIONS = ['O que é deságio?', 'Sou obrigado a aceitar a duplicata?', 'Como funciona o leilão?'];

export const CHAT_ANSWERS: Record<string, string> = {
  'O que é deságio?': 'Deságio é a diferença entre o valor de face da duplicata e o valor líquido pago por ela na antecipação — funciona como o "juro" embutido na compra do recebível. No marketplace Lastro, o leilão entre vários financiadores tende a reduzir esse deságio.',
  'Sou obrigado a aceitar a duplicata?': 'Não. Como sacado, você pode confirmar (aceite expresso) ou contestar a duplicata dentro do prazo legal. Se você não se manifestar dentro do prazo, ocorre o aceite tácito, e o título passa a valer como garantia de crédito mesmo assim.',
  'Como funciona o leilão?': 'Quando uma duplicata entra em leilão, bancos, FIDCs e fintechs cadastrados enviam lances (taxas de deságio). A menor taxa competitiva vence, e o cedente recebe o valor líquido assim que o leilão fecha — normalmente em até 24h.',
};

export const KYB_TIPOS = ['Banco comercial', 'Fundo (FIDC)', 'Fintech de crédito', 'Family office'];

export const ONBOARDING_STEPS: Record<'investidor' | 'cedente' | 'sacado' | 'admin', { title: string; body: string }[]> = {
  admin: [],
  investidor: [
    { title: 'Bem-vinda, Marina', body: 'Você está entrando como Investidor/Financiador. Vamos te mostrar o essencial em 3 passos rápidos.' },
    { title: 'Explore o Marketplace', body: 'Veja ofertas com score de risco, status de aceite e seguro disponível — dê lances no leilão ao vivo.' },
    { title: 'Acompanhe sua Carteira', body: 'Retornos, histórico de operações e rentabilidade média ficam em Carteira & Histórico.' },
  ],
  cedente: [
    { title: 'Bem-vinda, Marina', body: 'Você está entrando como Empresa (cedente). Vamos preparar sua primeira antecipação.' },
    { title: 'Complete seu KYC', body: 'Em Conta & Liquidação, conecte sua conta bancária e envie os documentos societários.' },
    { title: 'Emita sua primeira duplicata', body: 'Em Emitir Duplicata, registre o título na CERC e envie para o Marketplace em poucos cliques.' },
  ],
  sacado: [
    { title: 'Bem-vinda, Marina', body: 'Você está entrando como Empresa (sacado). Sua função aqui é confirmar ou contestar duplicatas.' },
    { title: 'Veja duplicatas pendentes', body: 'O Portal do Sacado lista tudo que espera sua manifestação, com prazo em destaque.' },
    { title: 'Confirme ou conteste', body: 'Sua resposta em até 10 dias úteis dá validade jurídica plena ao título — sem ela, ninguém financia com segurança.' },
  ],
};

export const ROLE_TABS: Record<'investidor' | 'cedente' | 'sacado' | 'admin', string[]> = {
  admin: ['admin', 'perfil'],
  investidor: ['dashboard', 'marketplace', 'automacao', 'risco', 'historico', 'comparador', 'compliance', 'conta', 'receita', 'disputa', 'perfil'],
  cedente: ['dashboard', 'erp', 'emitir', 'minhas', 'aceite', 'risco', 'historico', 'compliance', 'dev', 'conta', 'receita', 'disputa', 'perfil'],
  sacado: ['dashboard', 'sacado', 'historico', 'conta', 'disputa', 'perfil'],
};

export const PLAYGROUND_ENDPOINTS: Record<string, { method: string; path: string; fields: string[]; label: string }> = {
  emitir: { method: 'POST', path: '/v1/duplicatas', fields: ['sacado_cnpj', 'valor', 'vencimento', 'seguro'], label: 'Emitir duplicata' },
  consultar: { method: 'GET', path: '/v1/duplicatas/:id', fields: ['duplicata_id'], label: 'Consultar duplicata' },
  lance: { method: 'POST', path: '/v1/leiloes/:id/lances', fields: ['leilao_id', 'taxa'], label: 'Enviar lance no leilão' },
  score: { method: 'GET', path: '/v1/sacados/:cnpj/score', fields: ['cnpj'], label: 'Score de risco do sacado' },
  webhook: { method: 'POST', path: '/v1/webhooks', fields: ['url', 'evento'], label: 'Registrar webhook' },
};

export const PLAYGROUND_FIELD_LABELS: Record<string, string> = {
  sacado_cnpj: 'CNPJ do sacado', valor: 'Valor (R$)', vencimento: 'Vencimento', seguro: 'Seguro (true/false)',
  duplicata_id: 'ID da duplicata', leilao_id: 'ID do leilão', taxa: 'Taxa ofertada (% a.m.)', cnpj: 'CNPJ',
  url: 'URL do webhook', evento: 'Evento',
};

export const API_LOG_SEED = [
  { status: '200', method: 'POST', path: '/v1/duplicatas', time: 'há 2 min' },
  { status: '200', method: 'GET', path: '/v1/duplicatas/dup_9f2a', time: 'há 14 min' },
  { status: '200', method: 'POST', path: '/v1/leiloes/dup_9f2a/lances', time: 'há 26 min' },
  { status: '401', method: 'POST', path: '/v1/duplicatas', time: 'há 1 h' },
  { status: '200', method: 'GET', path: '/v1/sacados/score', time: 'há 3 h' },
];

export const AUTO_BID_OFFERS = [
  { sacado: 'Grupo Atlas Varejo', score: 'AA', setor: 'Varejo' },
  { sacado: 'Distribuidora Bom Preço', score: 'A', setor: 'Varejo' },
  { sacado: 'Metalúrgica Serrana S.A.', score: 'B', setor: 'Indústria' },
  { sacado: 'Construtora Vale Norte', score: 'C', setor: 'Construção' },
  { sacado: 'Aços Regional', score: 'A', setor: 'Indústria' },
  { sacado: 'Grupo Nortis Serviços', score: 'B', setor: 'Serviços' },
];

export const AUTO_BID_ACTIVITY_SEED = [
  { text: 'Automação aplicada — lance de 1,9% enviado em Grupo Atlas Varejo (score AA), dentro do parâmetro', color: COLORS.GREEN, time: 'há 12 min' },
  { text: 'Oferta de Construtora Vale Norte ignorada — score C abaixo do mínimo configurado (A)', color: '#5B6472', time: 'há 34 min' },
  { text: 'Automação aplicada — lance de 2,3% enviado em Distribuidora Bom Preço (score A), dentro do parâmetro', color: COLORS.GREEN, time: 'há 1 h' },
];
