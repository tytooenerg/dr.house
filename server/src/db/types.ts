export type Role = 'investidor' | 'cedente' | 'sacado' | 'admin' | 'seguradora' | 'auditor';
export type KybStatus = 'none' | 'pending' | 'approved' | 'rejected';
export type Plan = 'basico' | 'pro' | 'empresarial';
export type SubscriptionStatus = 'none' | 'active' | 'active_demo' | 'canceled' | 'past_due';

export interface UserSettings {
  onboardingSeen: boolean;
  // digest only means anything for an admin account (Resumo diário do back-office —
  // lib/dailyBriefing.ts) but lives on the same shared shape every role's notifPrefs
  // already uses, same as marketing being irrelevant-but-present for every role.
  notifPrefs: { leilao: boolean; aceite: boolean; disputa: boolean; marketing: boolean; digest: boolean };
  // WhatsApp/SMS is opt-in and separate from email prefs — a real deployment pays per
  // message (Twilio), so it shouldn't default to on the way free email notifications do.
  notifyViaWhatsapp: boolean;
  autoBidEnabled: boolean;
  autoBidRules: { scoreMin: string; taxaMax: string; exposicaoSacado: string; exposicaoMensal: string };
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
}

export function defaultSettings(): UserSettings {
  return {
    onboardingSeen: false,
    notifPrefs: { leilao: true, aceite: true, disputa: true, marketing: false, digest: true },
    notifyViaWhatsapp: false,
    autoBidEnabled: false,
    autoBidRules: { scoreMin: 'A', taxaMax: '2.5', exposicaoSacado: '150.000', exposicaoMensal: '2.000.000' },
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
export type ApiKeyProduct = 'platform' | 'score_api' | 'pld_screening_api';

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
}
