export type Role = 'investidor' | 'cedente' | 'sacado';

export interface UserSettings {
  onboardingSeen: boolean;
  notifPrefs: { leilao: boolean; aceite: boolean; disputa: boolean; marketing: boolean };
  autoBidEnabled: boolean;
  autoBidRules: { scoreMin: string; taxaMax: string; exposicaoSacado: string; exposicaoMensal: string };
  diversification: { AA: number; A: number; B: number; C: number };
  sectorDiversification: { varejo: number; industria: number; construcao: number; servicos: number };
  erpConnections: { sap: boolean; totvs: boolean; omie: boolean; whitelabel: boolean };
  settlementSpeed: 'd0' | 'd1';
  kycBankConnected: boolean;
  kycDocsUploaded: boolean;
  kycDocsRejected: boolean;
  kycDocsAttempts: number;
  liveKeyRevealed: boolean;
  webhookEnabled: boolean;
  playgroundEndpoint: string;
  playgroundParams: Record<string, string>;
  fidcPL: string;
}

export function defaultSettings(): UserSettings {
  return {
    onboardingSeen: false,
    notifPrefs: { leilao: true, aceite: true, disputa: true, marketing: false },
    autoBidEnabled: false,
    autoBidRules: { scoreMin: 'A', taxaMax: '2.5', exposicaoSacado: '150.000', exposicaoMensal: '2.000.000' },
    diversification: { AA: 20, A: 35, B: 30, C: 15 },
    sectorDiversification: { varejo: 30, industria: 25, construcao: 20, servicos: 25 },
    erpConnections: { sap: false, totvs: false, omie: false, whitelabel: false },
    settlementSpeed: 'd1',
    kycBankConnected: false,
    kycDocsUploaded: false,
    kycDocsRejected: false,
    kycDocsAttempts: 0,
    liveKeyRevealed: false,
    webhookEnabled: true,
    playgroundEndpoint: 'emitir',
    playgroundParams: {
      sacado_cnpj: '12.345.678/0001-90', valor: '84500.00', vencimento: '2026-08-12', seguro: 'true',
      duplicata_id: 'dup_9f2a', leilao_id: 'dup_9f2a', taxa: '1.8', cnpj: '58.442.111/0001-27',
      url: 'https://webhook.seusistema.com.br/lastro', evento: 'duplicata.registrada',
    },
    fidcPL: '5.000.000',
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
  settings: string;
  created_at: string;
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
  created_at: string;
}

export interface AceiteRow {
  id: number;
  duplicata_id: string;
  status: 'aguardando' | 'aceita' | 'contestada';
  prazo_label: string;
  created_at: string;
}

export interface DisputeRow {
  id: number;
  aceite_id: number;
  motivo: string;
  evidence_status: 'enviando' | 'enviada' | null;
  resolved: number;
  created_at: string;
}
