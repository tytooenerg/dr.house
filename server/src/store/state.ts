import { API_LOG_SEED, AUTO_BID_ACTIVITY_SEED, TEAM_MEMBERS } from '../data/seed.js';

export type Role = 'investidor' | 'cedente' | 'sacado';
export type AceiteStatus = 'aceita' | 'aguardando' | 'contestada';

export interface EmitForm {
  sacado: string;
  cnpj: string;
  valor: string;
  vencimento: string;
  seguro: boolean;
}

export interface BatchRow {
  id: string;
  valor: string;
}

export interface AppState {
  // session / auth
  isLoggedIn: boolean;
  pickedRole: Role | null;
  userRole: Role | null;
  showKyb: boolean;
  kybStep: number;
  kybDone: boolean;
  kybForm: { cnpj: string; tipo: string; pl: string };
  showOnboarding: boolean;
  onboardingStep: number;

  // marketplace
  purchased: Record<number, boolean>;
  expandedOfferId: number | null;
  offerExpandedAt: Record<number, number>;
  insuredOffers: Record<number, string | null>;
  offerCloseAt: Record<number, number>;
  marketQuery: string;
  marketSort: string;

  // minhas duplicatas
  leiloesDisparados: Record<string, boolean>;
  emittedDuplicatas: { id: string; sacado: string; valor: number; emissao: string; vencimento: string; status: string; lastro: number }[];

  // emitir
  emitForm: EmitForm;
  batchRows: BatchRow[];
  nfAnexada: boolean;
  emitSubmitted: boolean;
  emitLoading: boolean;
  emitError: string | null;
  lastRegistro: string | null;

  // aceite / disputa
  aceites: Record<number, AceiteStatus>;
  pendingAceiteId: number | null;
  disputeEvidence: Record<number, 'enviando' | 'enviada'>;

  // risco
  riskQuery: string;
  selectedSacadoName: string | null;

  // automação de lances
  autoBidEnabled: boolean;
  autoBidRules: { scoreMin: string; taxaMax: string; exposicaoSacado: string; exposicaoMensal: string };
  diversification: { AA: number; A: number; B: number; C: number };
  sectorDiversification: { varejo: number; industria: number; construcao: number; servicos: number };
  autoBidActivity: { text: string; color: string; time: string }[];

  // comparador
  comparadorInput: { valor: string; prazo: string; score: string };

  // erp
  erpConnections: { sap: boolean; totvs: boolean; omie: boolean; whitelabel: boolean };

  // compliance
  fidcPL: string;
  dupQuery: string;
  dupChecked: boolean;

  // dev
  liveKeyRevealed: boolean;
  webhookEnabled: boolean;
  apiLog: { status: string; method: string; path: string; time: string }[];
  playgroundEndpoint: string;
  playgroundParams: Record<string, string>;
  playgroundLoading: boolean;
  playgroundResult: { status: number; latency: number; body: string } | null;

  // perfil
  profileForm: { nome: string; email: string; telefone: string };
  notifPrefs: { leilao: boolean; aceite: boolean; disputa: boolean; marketing: boolean };
  teamMembers: { nome: string; email: string; papel: string }[];

  // conta
  kycBankConnected: boolean;
  kycDocsUploaded: boolean;
  kycDocsRejected: boolean;
  kycDocsAttempts: number;
  settlementSpeed: 'd0' | 'd1';

  // notifications
  notifRead: boolean;
}

export function createInitialState(): AppState {
  return {
    isLoggedIn: false,
    pickedRole: null,
    userRole: null,
    showKyb: false,
    kybStep: 0,
    kybDone: false,
    kybForm: { cnpj: '', tipo: 'Banco comercial', pl: '' },
    showOnboarding: false,
    onboardingStep: 0,

    purchased: {},
    expandedOfferId: null,
    offerExpandedAt: {},
    insuredOffers: {},
    offerCloseAt: {},
    marketQuery: '',
    marketSort: 'taxa',

    leiloesDisparados: {},
    emittedDuplicatas: [],

    emitForm: { sacado: '', cnpj: '', valor: '', vencimento: '', seguro: false },
    batchRows: [],
    nfAnexada: false,
    emitSubmitted: false,
    emitLoading: false,
    emitError: null,
    lastRegistro: null,

    aceites: {},
    pendingAceiteId: null,
    disputeEvidence: {},

    riskQuery: '',
    selectedSacadoName: null,

    autoBidEnabled: false,
    autoBidRules: { scoreMin: 'A', taxaMax: '2.5', exposicaoSacado: '150.000', exposicaoMensal: '2.000.000' },
    diversification: { AA: 20, A: 35, B: 30, C: 15 },
    sectorDiversification: { varejo: 30, industria: 25, construcao: 20, servicos: 25 },
    autoBidActivity: AUTO_BID_ACTIVITY_SEED.map((a) => ({ ...a })),

    comparadorInput: { valor: '50.000', prazo: '30', score: 'A' },

    erpConnections: { sap: false, totvs: false, omie: false, whitelabel: false },

    fidcPL: '5.000.000',
    dupQuery: '',
    dupChecked: false,

    liveKeyRevealed: false,
    webhookEnabled: true,
    apiLog: API_LOG_SEED.map((r) => ({ ...r })),
    playgroundEndpoint: 'emitir',
    playgroundParams: {
      sacado_cnpj: '12.345.678/0001-90', valor: '84500.00', vencimento: '2026-08-12', seguro: 'true',
      duplicata_id: 'dup_9f2a', leilao_id: 'dup_9f2a', taxa: '1.8', cnpj: '58.442.111/0001-27',
      url: 'https://webhook.seusistema.com.br/lastro', evento: 'duplicata.registrada',
    },
    playgroundLoading: false,
    playgroundResult: null,

    profileForm: { nome: 'Marina Costa', email: 'marina.costa@empresa.com.br', telefone: '(11) 98765-4321' },
    notifPrefs: { leilao: true, aceite: true, disputa: true, marketing: false },
    teamMembers: TEAM_MEMBERS.map((m) => ({ ...m })),

    kycBankConnected: false,
    kycDocsUploaded: false,
    kycDocsRejected: false,
    kycDocsAttempts: 0,
    settlementSpeed: 'd1',

    notifRead: false,
  };
}

export const state: AppState = createInitialState();

export function resetState() {
  Object.assign(state, createInitialState());
}
