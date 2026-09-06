import type { Rating } from '../data/seed.js';

// 'api_partner' is a self-service, no-KYB role for a company that only wants the
// standalone data products (Score API / PLD Screening API — see lib/addOnBilling.ts and
// routes/v1.ts) without becoming a marketplace participant (cedente/investidor/sacado/
// seguradora) — see "Score/PLD API como produto standalone" in README. It never touches
// duplicatas, never needs KYB (needsKyb below is investidor-only by design), and its only
// tabs are Desenvolvedores/Conta/Assinatura/Perfil.
// 'anunciante' is the same no-KYB, self-service shape for a company that just wants a slot
// in the landing page's ad carousel (db/advertisements.ts, lib/advertisementBilling.ts) —
// its only tab is Publicidade (plus Conta, to deposit real money via Pix/boleto/TED into
// the ledger balance the monthly ad fee is charged against, and Perfil).
export type Role = 'investidor' | 'cedente' | 'sacado' | 'admin' | 'seguradora' | 'auditor' | 'api_partner' | 'anunciante';
export type KybStatus = 'none' | 'pending' | 'approved' | 'rejected';
export type Plan = 'basico' | 'pro' | 'empresarial';
export type SubscriptionStatus = 'none' | 'active' | 'active_demo' | 'canceled' | 'past_due';
// Faixa de faturamento anual autodeclarada — usada só por lib/complianceCalendarCore.ts
// pra calcular o prazo de obrigatoriedade da duplicata escritural desta empresa. Definido
// aqui (não em complianceCalendarCore.ts) pra esse arquivo poder importar de db/types.ts
// sem criar um ciclo de import.
export type FaturamentoBracket = 'acima_300m' | 'entre_90m_300m' | 'entre_4_8m_90m' | 'ate_4_8m';

// Escada de lances por classe de rating (Automação de Lances) — substitui o antigo teto
// único `autoBidRules.taxaMax`. A automação começa exigente (só aceita o deságio mais alto
// que essa classe costuma ter — mais favorável ao investidor) e relaxa um degrau a cada
// `intervaloHoras` sem compra, até o piso `taxaAlvo`. `taxaInicial`/`taxaAlvo` nulos usam a
// banda ao vivo de lib/dynamicPricing.ts's estimateRateBand(rating) (max/min, já ajustada
// por liquidez real) em vez de duplicar esses números aqui — ver lib/autoBidLadder.ts.
export interface LadderConfig {
  taxaInicial: number | null;
  taxaAlvo: number | null;
  decrementoPorEtapa: number;
  intervaloHoras: number;
  iniciadoEm: string | null;
}

export interface UserSettings {
  onboardingSeen: boolean;
  // digest only means anything for an admin account (Resumo diário do back-office —
  // lib/dailyBriefing.ts) but lives on the same shared shape every role's notifPrefs
  // already uses, same as marketing being irrelevant-but-present for every role.
  notifPrefs: { leilao: boolean; aceite: boolean; disputa: boolean; marketing: boolean; digest: boolean; compliance: boolean };
  // WhatsApp/SMS is opt-in and separate from email prefs — a real deployment pays per
  // message (Twilio), so it shouldn't default to on the way free email notifications do.
  notifyViaWhatsapp: boolean;
  autoBidEnabled: boolean;
  autoBidRules: { scoreMin: string; exposicaoSacado: string; exposicaoMensal: string };
  autoBidLadder: Record<Rating, LadderConfig>;
  diversification: { AA: number; A: number; B: number; C: number };
  sectorDiversification: { varejo: number; industria: number; construcao: number; servicos: number };
  erpConnections: { sap: boolean; totvs: boolean; omie: boolean; whitelabel: boolean };
  omieCredentials: { appKey: string; appSecret: string } | null;
  sapCredentials: { baseUrl: string; companyDb: string; username: string; password: string } | null;
  totvsCredentials: { baseUrl: string; clientId: string; clientSecret: string } | null;
  // Opt-in, mirrors autoBidEnabled's opt-in-with-rules pattern on the investor side —
  // pulls new open contas a receber from a connected ERP and auto-emits them as
  // duplicatas without a manual click, capped at autoEmitMaxValor per emission.
  autoEmitEnabled: boolean;
  autoEmitMaxValor: string;
  whitelabelBrand: { nome: string; corPrimaria: string; logoUrl: string } | null;
  biometricVerified: boolean;
  settlementSpeed: 'd0' | 'd1';
  kycBankConnected: boolean;
  pixChave: string | null;
  // Destination bank account for TED withdrawals — a separate field from pixChave
  // because TED needs full banking coordinates (banco/agência/conta), not a Pix key.
  tedContaBancaria: { banco: string; agencia: string; conta: string; tipoConta: 'corrente' | 'poupanca'; titularNome: string; titularCnpj: string } | null;
  // Destination wallet address for stablecoin withdrawals — same role as pixChave/
  // tedContaBancaria but for lib/stablecoinRail.ts. Only the address is stored; asset
  // and network are a platform-wide choice (STABLECOIN_ASSET/STABLECOIN_NETWORK), not
  // per-user, since Lastro settles in one stablecoin/network combination at a time.
  stablecoinWalletEndereco: string | null;
  kycDocsUploaded: boolean;
  kycDocsRejected: boolean;
  kycDocsAttempts: number;
  playgroundEndpoint: string;
  playgroundParams: Record<string, string>;
  fidcPL: string;
  // Opt-in, same "opt-in with rules" shape as autoBidEnabled/autoEmitEnabled — lets the
  // Market Maker agent (lib/agents/marketMaker.ts) place liquidity-providing bids on this
  // investor's behalf, capped by marketMakerMaxExposicao and marketMakerMinScore.
  marketMakerEnabled: boolean;
  marketMakerMaxExposicao: string;
  marketMakerMinScore: string;
  // CNPJ da própria empresa de quem está logado — originalmente só pro AI CFO (plano
  // Empresarial) consultar o saldo bancário real via lib/openFinance.ts (que já existia e
  // era consultado por CNPJ, mas só com o CNPJ de um sacado, na análise de risco, nunca
  // com o do próprio cedente). Reaproveitado por lib/confirmingCore.ts pro sacado
  // autodeclarar seu próprio CNPJ ao criar um Programa Confirming — mesmo campo genérico
  // ("CNPJ da própria empresa"), sem sentido restringir a um papel só.
  companyCnpj: string;
  // Autodeclarado, editável depois — usado só por lib/complianceCalendarCore.ts pra
  // calcular o prazo de obrigatoriedade da duplicata escritural desta empresa (cedente ou
  // sacado). Nunca inferido do Open Finance/DRE do AI CFO: aquele fluxo cobre só 90 dias
  // de duplicatas do próprio Lastro, não o faturamento anual real da empresa — e só existe
  // pra cedente Empresarial, nunca pra sacado. null até a empresa informar pela primeira vez.
  faturamentoAnualBracket: FaturamentoBracket | null;
  // Controla o job de lembrete do cronograma de conformidade (lib/complianceCalendarReminder.ts)
  // — dois carimbos separados porque são dois estados distintos e não excludentes ao longo
  // do tempo: uma empresa pode ser lembrada de informar o faturamento, informar meses
  // depois, e só então precisar ser lembrada de novo (desta vez por urgência de prazo) —
  // um carimbo único apagaria essa segunda janela. null até o primeiro envio de cada tipo.
  complianceReminderNaoInformadoSentAt: string | null;
  complianceReminderUrgenciaSentAt: string | null;
}

export function defaultSettings(): UserSettings {
  return {
    onboardingSeen: false,
    notifPrefs: { leilao: true, aceite: true, disputa: true, marketing: false, digest: true, compliance: true },
    notifyViaWhatsapp: false,
    autoBidEnabled: false,
    autoBidRules: { scoreMin: 'A', exposicaoSacado: '150.000', exposicaoMensal: '2.000.000' },
    autoBidLadder: {
      AA: { taxaInicial: null, taxaAlvo: null, decrementoPorEtapa: 0.1, intervaloHoras: 4, iniciadoEm: null },
      A: { taxaInicial: null, taxaAlvo: null, decrementoPorEtapa: 0.1, intervaloHoras: 4, iniciadoEm: null },
      B: { taxaInicial: null, taxaAlvo: null, decrementoPorEtapa: 0.1, intervaloHoras: 4, iniciadoEm: null },
      C: { taxaInicial: null, taxaAlvo: null, decrementoPorEtapa: 0.1, intervaloHoras: 4, iniciadoEm: null },
    },
    diversification: { AA: 20, A: 35, B: 30, C: 15 },
    sectorDiversification: { varejo: 30, industria: 25, construcao: 20, servicos: 25 },
    erpConnections: { sap: false, totvs: false, omie: false, whitelabel: false },
    omieCredentials: null,
    sapCredentials: null,
    totvsCredentials: null,
    autoEmitEnabled: false,
    autoEmitMaxValor: '50.000',
    whitelabelBrand: null,
    biometricVerified: false,
    settlementSpeed: 'd1',
    kycBankConnected: false,
    pixChave: null,
    tedContaBancaria: null,
    stablecoinWalletEndereco: null,
    kycDocsUploaded: false,
    kycDocsRejected: false,
    kycDocsAttempts: 0,
    playgroundEndpoint: 'emitir',
    playgroundParams: {
      sacado_cnpj: '12.345.678/0001-90', valor: '84500.00', vencimento: '2026-08-12', seguro: 'true',
      duplicata_id: 'dup_9f2a', leilao_id: 'dup_9f2a', taxa: '1.8', cnpj: '58.442.111/0001-27',
      url: 'https://webhook.seusistema.com.br/lastro', evento: 'duplicata.registrada',
    },
    fidcPL: '5.000.000',
    marketMakerEnabled: false,
    marketMakerMaxExposicao: '200.000',
    marketMakerMinScore: '60',
    companyCnpj: '',
    faturamentoAnualBracket: null,
    complianceReminderNaoInformadoSentAt: null,
    complianceReminderUrgenciaSentAt: null,
  };
}

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  nome: string;
  telefone: string;
  company_name: string;
  role: Role;
  kyb_done: number;
  kyb_form: string;
  kyb_status: KybStatus;
  kyb_reject_reason: string;
  plan: Plan;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: SubscriptionStatus;
  plan_current_period_end: string | null;
  insurer_key: string | null;
  settings: string;
  created_at: string;
  deleted_at: string | null;
  referral_code: string | null;
  referred_by_user_id: number | null;
  referral_bonus_emissions: number;
  pld_status: 'clear' | 'flagged';
  pld_match_note: string;
  team_owner_id: number | null;
  totp_secret: string | null;
  totp_enabled: number;
  google_sub: string | null;
  saml_subject_id: string | null;
  auth_provider: 'password' | 'google' | 'saml';
  whitelabel_plus_enabled: number;
  institutional_reporting_enabled: number;
  whitelabel_custom_domain: string | null;
}

export interface DuplicataRow {
  id: string;
  cedente_id: number | null;
  cedente_nome: string;
  sacado_nome: string;
  sacado_cnpj: string;
  valor: number;
  vencimento: string;
  emissao: string;
  status: string;
  lastro_pct: number;
  seguro: number;
  insurer_key: string | null;
  registro: string | null;
  desagio: string | null;
  score: number | null;
  close_at: string | null;
  leilao_started_at: string | null;
  sinistro_status: 'none' | 'aberto' | 'aprovado' | 'negado';
  sinistro_note: string | null;
  registradora: string | null;
  nfe_chave: string | null;
  compliance_score: number | null;
  created_at: string;
  // 1 for duplicatas created via a test-mode partner API key (lib/sandboxData.ts) —
  // filtered out of every live/internal read at the query layer (db/duplicatas.ts).
  sandbox: number;
  // Derived once at emission time from the sacado's seeded risk profile (lib/riscoCore.ts's
  // sectorFor), same pattern as `score` — null when the sacado has no seeded profile at all.
  setor: string | null;
  // Instante em que o job de fechamento adjudicou o leilão (lib/auctionClose.ts) — null
  // enquanto aberto, e também quando fechou sem nenhum lance elegível.
  leilao_fechado_em: string | null;
  // Pior deságio mensal que o cedente aceita neste leilão. NULL = usa a banda de mercado
  // (lib/dynamicPricing.ts) como sugestão — ver migração 0069.
  reserva_taxa_am: number | null;
}

export type NetworkSignalTipo = 'pagamento_pontual' | 'atraso' | 'protesto' | 'contestacao';

export interface NetworkSignalRow {
  id: number;
  cnpj: string;
  reporter_user_id: number;
  tipo: NetworkSignalTipo;
  nota: string | null;
  created_at: string;
}

export type ApiKeyMode = 'live' | 'test';
export type ApiKeyScope = 'read_only' | 'read_write';
// 'platform' is the full partner API (today's only behavior); 'score_api' and
// 'pld_screening_api' are narrow, standalone data-product keys (lib/addOnBilling.ts) —
// sellable to a company that isn't a Lastro cedente/investidor/sacado at all.
// 'registro_api' — feature "compliance-as-a-service": the multi-registradora smart
// routing (lib/registradoras.ts) exposed for the first time to a third party that isn't
// a Lastro cedente, standalone and pay-per-call, same shape as score_api/pld_screening_api.
// 6 more narrow, standalone data products (same shape again — no marketplace/duplicata
// access, sold on their own, billed per call): 'judicial_records_api' wraps
// lib/judicialRecords.ts, 'fraud_screening_api' wraps lib/fraudScreeningApi.ts,
// 'document_intelligence_api' wraps lib/contractAnalysis.ts + lib/nfeExtraction.ts,
// 'reconciliation_api' wraps lib/reconciliationApi.ts, 'suitability_api' wraps
// lib/suitability.ts's stateless scorer, 'market_index_api' wraps lib/marketIndex.ts.
export type ApiKeyProduct =
  | 'platform'
  | 'score_api'
  | 'pld_screening_api'
  | 'registro_api'
  | 'judicial_records_api'
  | 'fraud_screening_api'
  | 'document_intelligence_api'
  | 'reconciliation_api'
  | 'suitability_api'
  | 'market_index_api';

export interface ApiKeyRow {
  id: number;
  user_id: number;
  key_hash: string;
  key_prefix: string;
  label: string;
  revoked: number;
  mode: ApiKeyMode;
  scope: ApiKeyScope;
  product: ApiKeyProduct;
  last_used_at: string | null;
  created_at: string;
}

export interface WebhookRow {
  id: number;
  user_id: number;
  url: string;
  event: string;
  secret: string;
  active: number;
  created_at: string;
}

export interface InsuranceSettlementRow {
  id: number;
  duplicata_id: string;
  investor_id: number;
  insurer_key: string;
  premio: number;
  comissao_lastro: number;
  repasse_seguradora: number;
  created_at: string;
}

export interface PlatformFeeEventRow {
  id: number;
  duplicata_id: string;
  valor: number;
  fee_valor: number;
  origem: 'compra' | 'revenda';
  created_at: string;
}

export type WebhookDeliveryStatus = 'pending' | 'success' | 'failed';

export interface WebhookDeliveryRow {
  id: number;
  webhook_id: number;
  event: string;
  payload: string;
  status: WebhookDeliveryStatus;
  attempt: number;
  response_status: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface AceiteRow {
  id: number;
  duplicata_id: string;
  status: 'aguardando' | 'aceita' | 'contestada';
  prazo_label: string;
  prazo_limite: string | null;
  reminder_sent: number;
  created_at: string;
}

export type ComplianceAlertType = 'nfe_duplicidade' | 'valor_anomalo' | 'pld_screening';
export type ComplianceAlertSeverity = 'info' | 'atencao' | 'critico';

export interface ComplianceAlertRow {
  id: number;
  type: ComplianceAlertType;
  severity: ComplianceAlertSeverity;
  message: string;
  user_id: number | null;
  duplicata_id: string | null;
  created_at: string;
}

export interface ResaleListingRow {
  id: number;
  purchase_id: number;
  duplicata_id: string;
  seller_id: number;
  asking_valor: number;
  status: 'ativo' | 'vendido' | 'cancelado';
  created_at: string;
}

export type ResaleBidStatus = 'ativo' | 'aceito' | 'recusado' | 'cancelado' | 'superado';

export interface ResaleBidRow {
  id: number;
  listing_id: number;
  bidder_id: number;
  valor: number;
  status: ResaleBidStatus;
  created_at: string;
}

export type AuctionBidStatus = 'ativo' | 'vencedor' | 'perdedor' | 'cancelado';

// Lance no leilão primário. `taxa_am` é o deságio mensal proposto pelo investidor: MENOR
// taxa = cedente recebe mais = lance melhor. `preco` congela o que essa taxa vale em reais
// no instante do lance, pro vencedor não ser reprecificado por variação de liquidez entre
// o lance e o fechamento.
export interface AuctionBidRow {
  id: number;
  duplicata_id: string;
  bidder_id: number;
  taxa_am: number;
  preco: number;
  status: AuctionBidStatus;
  created_at: string;
}

export interface BlockTradeRow {
  id: number;
  buyer_id: number;
  criteria_json: string;
  quantidade: number;
  valor_total: number;
  desconto_pct: number;
  created_at: string;
}

export interface BlockTradeItemRow {
  id: number;
  block_trade_id: number;
  listing_id: number;
  duplicata_id: string;
  seller_id: number;
  valor: number;
}

export interface SystemHealthCheckRow {
  id: number;
  status: 'ok' | 'degraded';
  latency_ms: number;
  created_at: string;
}

export interface DisputeRow {
  id: number;
  aceite_id: number;
  motivo: string;
  evidence_status: 'enviando' | 'enviada' | null;
  resolved: number;
  resolution: string;
  resolved_by: number | null;
  resolved_at: string | null;
  created_at: string;
  // Autocomposição real exige as duas partes: o cedente propõe (estes 3 campos), e só
  // vira resolução de verdade (resolved=1) quando o próprio sacado confirma — ver
  // routes/disputas.ts. Uma proposta pendente nunca muda `resolved` nem o aceite.
  proposed_resolution: string | null;
  proposed_by: number | null;
  proposed_at: string | null;
}
