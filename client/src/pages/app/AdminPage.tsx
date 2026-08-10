import { useEffect, useState } from 'react';
import { api, ApiError, downloadFile } from '../../lib/api';
import { PageHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { AgentesIaPanel } from './admin/AgentesIaPanel';
import { FeatureFlagsPanel } from './admin/FeatureFlagsPanel';

interface PendingKyb {
  id: number;
  nome: string;
  email: string;
  companyName: string;
  kybForm: { cnpj?: string; tipo?: string; pl?: string; paisDomicilio?: string; taxIdEstrangeiro?: string; representanteLegal?: string };
  naoResidente: boolean;
  submittedAt: string;
  pldStatus: 'clear' | 'flagged';
  pldMatchNote: string;
  aiTriage: { runId: number; status: string; summary: string | null; pendingActionId: number | null; pendingActionTool: 'aprovar_kyb' | 'rejeitar_kyb' | null } | null;
}

interface ForeignInvestorScreening {
  id: number;
  paisDomicilio: string;
  jurisdicaoFavorecida: boolean;
  classificacao: 'profissional' | 'qualificado' | 'nao_classificado';
  representanteLegal: string;
  pldStatus: 'clear' | 'flagged';
  pldDetail: string;
  memo: string;
  quando: string;
}

interface AdminDispute {
  id: number;
  duplicataId: string;
  sacado: string;
  cedente: string;
  valorFmt: string;
  motivo: string;
  timeline: { autor: string; texto: string; quando: string }[];
}

interface AuditEntry {
  id: number;
  actor: string;
  action: string;
  payload: Record<string, unknown>;
  hash: string;
  quando: string;
}

interface ComplianceQueueItem {
  duplicataId: string;
  sacado: string;
  cedente: string;
  valorFmt: string;
  vencimento: string;
  score: number;
  breakdown: { fator: string; pontos: number; detalhe: string }[];
  reasoning: string;
  quando: string;
}

interface MlScoringStatus {
  minTrainingSamples: number;
  model: { nSamples: number; nPositive: number; trainAccuracy: number; trainedAt: string; featureNames: string[]; weights: number[] } | null;
}

interface AiUsageSummary {
  totalCalls: number;
  failedCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEstimatedCostUsd: number;
  byFeature: { feature: string; calls: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number }[];
  last30Days: { date: string; calls: number; estimatedCostUsd: number }[];
}

const FEATURE_LABELS: Record<string, string> = {
  chat: 'Assistente (chat)',
  nfe_extraction: 'Extração de NF-e',
  contract_analysis: 'Leitura de contratos',
  risco_narrative: 'Narrativa de risco',
  dispute_copilot: 'Copiloto de disputas',
  sinistro_copilot: 'Copiloto de sinistro',
  pld_second_opinion: 'Segunda opinião PLD',
  compliance_engine: 'Compliance AI Engine',
  legal_collection: 'Cobrança jurídica (IA)',
  regulatory_monitor: 'Monitor regulatório (IA)',
  legal_draft: 'Minutas jurídicas (IA)',
};

interface LegalDocRef {
  id: number;
  type: string;
  content: string;
  reviewed: boolean;
  quando?: string;
}

interface OverdueCollectionItem {
  duplicataId: string;
  sacado: string;
  cedente: string;
  valor: number;
  valorFmt: string;
  vencimento: string;
  eligible: boolean;
  reason: string | null;
  diasEmAtraso: number;
  documentos: LegalDocRef[];
}

interface RecoveryEntry {
  duplicataId: string;
  sacado: string;
  cedente: string;
  recoveredValorFmt: string;
  feeValorFmt: string;
  feePct: number;
  chargedRole: 'cedente' | 'investidor';
  quando: string;
}

interface RegulatoryNote {
  id: number;
  title: string;
  summary: string;
  impactAreas: string[];
  recommendedActions: string;
  acknowledged: boolean;
  quando: string;
}

interface SarReport {
  id: number;
  empresa: string;
  email: string;
  tipo: 'fracionamento' | 'entrada_saida_rapida';
  severidade: 'atencao' | 'critico';
  descricao: string;
  status: 'aberto' | 'descartado' | 'reportado_coaf';
  externalReference: string | null;
  quando: string;
}

interface FundClaim {
  id: number;
  duplicataId: string;
  sacado: string;
  investidor: string;
  valorSolicitadoFmt: string;
  valorPagoFmt: string | null;
  status: 'aberto' | 'aprovado' | 'negado';
  note: string | null;
  createdAt: string;
}

interface StressTestResult {
  simulations: number;
  correlation: number;
  fundBalanceFmt: string;
  exposureCount: number;
  exposureTotalFmt: string;
  usingMlModel: boolean;
  pDepletion: number;
  expectedLossFmt: string;
  var95Fmt: string;
  var99Fmt: string;
  expectedShortfallFmt: string;
}

const SAR_TIPO_LABELS: Record<string, string> = {
  fracionamento: 'Fracionamento',
  entrada_saida_rapida: 'Entrada/saída rápida',
};

interface BackupInfo {
  filename: string;
  sizeBytes: number;
  createdAt: string;
  quando: string;
}

interface TedPendente {
  referencia: string;
  empresa: string;
  valorFmt: string;
  banco: string;
  agencia: string;
  conta: string;
  quando: string;
}

type AddOnKind = 'api_overage' | 'score_api' | 'pld_screening_api' | 'whitelabel_plus' | 'institutional_reporting';

interface AddonPrice {
  kind: AddOnKind;
  preco: number;
  precoFmt: string;
  padraoFmt: string;
}

interface AddonChargeSummary {
  kind: AddOnKind;
  totalFmt: string;
  count: number;
}

interface AddonRecentCharge {
  id: number;
  empresa: string;
  kind: AddOnKind;
  quantidade: number;
  valorFmt: string;
  descricao: string;
  quando: string;
}

const ADDON_KIND_LABELS: Record<AddOnKind, string> = {
  api_overage: 'Excedente de uso da API (por chamada)',
  score_api: 'Score API avulsa (por chamada)',
  pld_screening_api: 'PLD Screening API avulsa (por chamada)',
  whitelabel_plus: 'White-label Plus (mensal)',
  institutional_reporting: 'Relatórios Institucionais (mensal)',
};

const COLLECTION_DOC_LABELS: Record<string, string> = {
  notificacao_cobranca: 'Notificação extrajudicial',
  minuta_protesto: 'Minuta de protesto',
  peticao_execucao: 'Petição de execução',
};

const MINUTA_TYPE_LABELS: Record<string, string> = {
  resposta_lgpd: 'Resposta a titular (LGPD)',
  termos_atualizacao: 'Atualização de termos',
  notificacao_padrao: 'Notificação padrão',
};

type Tab = 'kyb' | 'disputas' | 'compliance' | 'juridico' | 'ia' | 'agentes' | 'flags' | 'auditoria';
type LegalSubTab = 'cobranca' | 'minutas' | 'regulatorio';

export function AdminPage() {
  const [tab, setTab] = useState<Tab>('kyb');
  const [pending, setPending] = useState<PendingKyb[]>([]);
  const [disputes, setDisputes] = useState<AdminDispute[]>([]);
  const [audit, setAudit] = useState<{ entries: AuditEntry[]; chain: { valid: boolean; brokenAt: number | null } } | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [decidingTriageId, setDecidingTriageId] = useState<number | null>(null);
  const [noteById, setNoteById] = useState<Record<number, string>>({});
  const [aiSummaryById, setAiSummaryById] = useState<Record<number, { recommendation: string; reasoning: string } | null>>({});
  const [loadingAiId, setLoadingAiId] = useState<number | null>(null);
  const [complianceQueue, setComplianceQueue] = useState<ComplianceQueueItem[]>([]);
  const [complianceNoteById, setComplianceNoteById] = useState<Record<string, string>>({});
  const [aiUsage, setAiUsage] = useState<AiUsageSummary | null>(null);
  const [mlScoring, setMlScoring] = useState<MlScoringStatus | null>(null);
  const [retrainingMl, setRetrainingMl] = useState(false);
  const [mlRetrainMessage, setMlRetrainMessage] = useState('');
  const [threshold, setThreshold] = useState<{ threshold: number; default: number } | null>(null);
  const [thresholdInput, setThresholdInput] = useState('');
  const [savingThreshold, setSavingThreshold] = useState(false);

  const [legalSubTab, setLegalSubTab] = useState<LegalSubTab>('cobranca');
  const [overdue, setOverdue] = useState<OverdueCollectionItem[]>([]);
  const [legalDisclaimer, setLegalDisclaimer] = useState('');
  const [generatingCollection, setGeneratingCollection] = useState<string | null>(null);
  const [collectionError, setCollectionError] = useState<Record<string, string>>({});
  const [feeConfig, setFeeConfig] = useState<{ feePct: number; default: number } | null>(null);
  const [feePctInput, setFeePctInput] = useState('');
  const [savingFeePct, setSavingFeePct] = useState(false);
  const [recoveringId, setRecoveringId] = useState<string | null>(null);
  const [recoveredValorInput, setRecoveredValorInput] = useState<Record<string, string>>({});
  const [recoveryError, setRecoveryError] = useState<Record<string, string>>({});
  const [recoveries, setRecoveries] = useState<RecoveryEntry[]>([]);
  const [minutas, setMinutas] = useState<LegalDocRef[]>([]);
  const [minutaType, setMinutaType] = useState<'resposta_lgpd' | 'termos_atualizacao' | 'notificacao_padrao'>('resposta_lgpd');
  const [minutaContext, setMinutaContext] = useState('');
  const [generatingMinuta, setGeneratingMinuta] = useState(false);
  const [minutaError, setMinutaError] = useState('');
  const [regulatoryNotes, setRegulatoryNotes] = useState<RegulatoryNote[]>([]);
  const [regTitle, setRegTitle] = useState('');
  const [regText, setRegText] = useState('');
  const [analyzingReg, setAnalyzingReg] = useState(false);
  const [regError, setRegError] = useState('');
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [backupsEnabled, setBackupsEnabled] = useState(true);
  const [runningBackup, setRunningBackup] = useState(false);
  const [tedPendentes, setTedPendentes] = useState<TedPendente[]>([]);
  const [confirmingTed, setConfirmingTed] = useState<string | null>(null);
  const [sarReports, setSarReports] = useState<SarReport[]>([]);
  const [sarThreshold, setSarThreshold] = useState<number | null>(null);
  const [sarThresholdInput, setSarThresholdInput] = useState('');
  const [savingSarThreshold, setSavingSarThreshold] = useState(false);
  const [scanningSar, setScanningSar] = useState(false);
  const [sarActionId, setSarActionId] = useState<number | null>(null);
  const [sarExternalRefById, setSarExternalRefById] = useState<Record<number, string>>({});
  const [downloadingCoafId, setDownloadingCoafId] = useState<number | null>(null);
  const [cvmPeriod, setCvmPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [downloadingCvm, setDownloadingCvm] = useState(false);
  const [fundClaims, setFundClaims] = useState<FundClaim[]>([]);
  const [fundBalanceFmt, setFundBalanceFmt] = useState('');
  const [decidingFundClaimId, setDecidingFundClaimId] = useState<number | null>(null);
  const [fundNoteById, setFundNoteById] = useState<Record<number, string>>({});
  const [stressResult, setStressResult] = useState<StressTestResult | null>(null);
  const [runningStress, setRunningStress] = useState(false);
  const [foreignScreeningsById, setForeignScreeningsById] = useState<Record<number, ForeignInvestorScreening[]>>({});
  const [generatingMemoId, setGeneratingMemoId] = useState<number | null>(null);
  const [addonPrices, setAddonPrices] = useState<AddonPrice[]>([]);
  const [addonPriceInputs, setAddonPriceInputs] = useState<Record<string, string>>({});
  const [savingAddonKind, setSavingAddonKind] = useState<AddOnKind | null>(null);
  const [addonResumo, setAddonResumo] = useState<AddonChargeSummary[]>([]);
  const [addonRecentes, setAddonRecentes] = useState<AddonRecentCharge[]>([]);
  const [includedCalls, setIncludedCalls] = useState<number | null>(null);
  const [includedCallsInput, setIncludedCallsInput] = useState('');
  const [savingIncluded, setSavingIncluded] = useState(false);
  const [runningAddonJob, setRunningAddonJob] = useState<string | null>(null);

  const loadKyb = () => api.get<{ pending: PendingKyb[] }>('/admin/kyb').then((d) => setPending(d.pending));
  const loadDisputes = () => api.get<{ disputes: AdminDispute[] }>('/admin/disputes').then((d) => setDisputes(d.disputes));
  const loadAudit = () => api.get<{ entries: AuditEntry[]; chain: { valid: boolean; brokenAt: number | null } }>('/admin/audit').then(setAudit);
  const loadCompliance = () => api.get<{ pending: ComplianceQueueItem[] }>('/admin/compliance-queue').then((d) => setComplianceQueue(d.pending));
  const loadAiUsage = () => api.get<AiUsageSummary>('/admin/ai-usage').then(setAiUsage);
  const loadMlScoring = () => api.get<MlScoringStatus>('/admin/ml-scoring').then(setMlScoring);
  const retrainMl = async () => {
    setRetrainingMl(true);
    setMlRetrainMessage('');
    try {
      const result = await api.post<{ trained: boolean; reason?: string }>('/admin/ml-scoring/retrain');
      setMlRetrainMessage(result.trained ? 'Modelo retreinado com sucesso.' : result.reason ?? 'Não foi possível treinar.');
      await loadMlScoring();
    } finally {
      setRetrainingMl(false);
    }
  };
  const loadThreshold = () =>
    api.get<{ threshold: number; default: number }>('/admin/compliance-threshold').then((d) => {
      setThreshold(d);
      setThresholdInput(String(d.threshold));
    });
  const loadCobrancaJuridica = () =>
    api.get<{ overdue: OverdueCollectionItem[]; disclaimer: string; feePct: number }>('/admin/juridico/cobranca').then((d) => {
      setOverdue(d.overdue);
      setLegalDisclaimer(d.disclaimer);
    });
  const loadMinutas = () => api.get<{ documentos: LegalDocRef[] }>('/admin/juridico/minutas').then((d) => setMinutas(d.documentos));
  const loadRegulatorio = () => api.get<{ notes: RegulatoryNote[] }>('/admin/juridico/regulatorio').then((d) => setRegulatoryNotes(d.notes));
  const loadFeeConfig = () =>
    api.get<{ feePct: number; default: number }>('/admin/juridico/cobranca-fee').then((d) => {
      setFeeConfig(d);
      setFeePctInput(String(d.feePct));
    });
  const loadRecoveries = () => api.get<{ recuperacoes: RecoveryEntry[] }>('/admin/juridico/recuperacoes').then((d) => setRecoveries(d.recuperacoes));
  const loadBackups = () =>
    api.get<{ enabled: boolean; backups: BackupInfo[] }>('/admin/backups').then((d) => {
      setBackupsEnabled(d.enabled);
      setBackups(d.backups);
    });
  const loadTedPendentes = () => api.get<{ pendentes: TedPendente[] }>('/admin/ted/pendentes').then((d) => setTedPendentes(d.pendentes));
  const loadSar = () =>
    api.get<{ reports: SarReport[]; threshold: number }>('/admin/pld/suspeitas?status=aberto').then((d) => {
      setSarReports(d.reports);
      setSarThreshold(d.threshold);
      setSarThresholdInput(String(d.threshold));
    });
  const loadAddonPrices = () =>
    api.get<{ precos: AddonPrice[] }>('/admin/addons/precos').then((d) => {
      setAddonPrices(d.precos);
      setAddonPriceInputs(Object.fromEntries(d.precos.map((p) => [p.kind, String(p.preco)])));
    });
  const loadAddonCobrancas = () =>
    api.get<{ resumo: AddonChargeSummary[]; recentes: AddonRecentCharge[] }>('/admin/addons/cobrancas').then((d) => {
      setAddonResumo(d.resumo);
      setAddonRecentes(d.recentes);
    });
  const loadApiOverageConfig = () =>
    api.get<{ included: number }>('/admin/api-overage/config').then((d) => {
      setIncludedCalls(d.included);
      setIncludedCallsInput(String(d.included));
    });
  const loadFundClaims = () =>
    api.get<{ claims: FundClaim[] }>('/admin/guarantee-fund/claims?status=aberto').then((d) => setFundClaims(d.claims));
  const loadFundBalance = () => api.get<{ balanceFmt: string }>('/admin/guarantee-fund').then((d) => setFundBalanceFmt(d.balanceFmt));

  useEffect(() => {
    loadKyb();
    loadDisputes();
    loadAudit();
    loadCompliance();
    loadAiUsage();
    loadMlScoring();
    loadThreshold();
    loadCobrancaJuridica();
    loadMinutas();
    loadRegulatorio();
    loadFeeConfig();
    loadRecoveries();
    loadBackups();
    loadTedPendentes();
    loadSar();
    loadFundClaims();
    loadFundBalance();
    loadAddonPrices();
    loadAddonCobrancas();
    loadApiOverageConfig();
  }, []);

  useEffect(() => {
    for (const p of pending) {
      if (p.naoResidente && !(p.id in foreignScreeningsById)) loadForeignScreenings(p.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const saveAddonPrice = async (kind: AddOnKind) => {
    const n = Number(addonPriceInputs[kind]);
    if (!Number.isFinite(n) || n <= 0) return;
    setSavingAddonKind(kind);
    try {
      await api.put('/admin/addons/precos', { kind, preco: n });
      await loadAddonPrices();
    } finally {
      setSavingAddonKind(null);
    }
  };

  const saveIncludedCalls = async () => {
    const n = Number(includedCallsInput);
    if (!Number.isFinite(n) || n <= 0) return;
    setSavingIncluded(true);
    try {
      await api.put('/admin/api-overage/config', { included: n });
      await loadApiOverageConfig();
    } finally {
      setSavingIncluded(false);
    }
  };

  const runAddonBillingJob = async (job: 'api-overage' | 'whitelabel-plus' | 'institutional-reporting') => {
    setRunningAddonJob(job);
    try {
      await api.post(`/admin/${job}/cobrar`);
      await loadAddonCobrancas();
    } finally {
      setRunningAddonJob(null);
    }
  };

  const saveSarThreshold = async () => {
    const n = Number(sarThresholdInput);
    if (!Number.isFinite(n) || n <= 0) return;
    setSavingSarThreshold(true);
    try {
      await api.put('/admin/pld/suspeitas/threshold', { threshold: n });
      await loadSar();
    } finally {
      setSavingSarThreshold(false);
    }
  };

  const runSarScan = async () => {
    setScanningSar(true);
    try {
      await api.post('/admin/pld/suspeitas/scan');
      await loadSar();
    } finally {
      setScanningSar(false);
    }
  };

  const dismissSar = async (id: number) => {
    setSarActionId(id);
    try {
      await api.post(`/admin/pld/suspeitas/${id}/descartar`);
      await loadSar();
      await loadAudit();
    } finally {
      setSarActionId(null);
    }
  };

  const reportSarToCoaf = async (id: number) => {
    const ref = (sarExternalRefById[id] ?? '').trim();
    if (!ref) return;
    setSarActionId(id);
    try {
      await api.post(`/admin/pld/suspeitas/${id}/reportar`, { externalReference: ref });
      await loadSar();
      await loadAudit();
    } finally {
      setSarActionId(null);
    }
  };

  const decideFundClaim = async (id: number, decision: 'aprovado' | 'negado') => {
    const note = (fundNoteById[id] ?? '').trim();
    if (!note) return;
    setDecidingFundClaimId(id);
    try {
      await api.post(`/admin/guarantee-fund/claims/${id}/decidir`, { decision, note });
      await loadFundClaims();
      await loadFundBalance();
      await loadAudit();
    } finally {
      setDecidingFundClaimId(null);
    }
  };

  const runStressTest = async () => {
    setRunningStress(true);
    try {
      const result = await api.get<StressTestResult>('/admin/guarantee-fund/stress-test?simulations=10000');
      setStressResult(result);
    } finally {
      setRunningStress(false);
    }
  };

  const downloadCoafReport = async (id: number) => {
    setDownloadingCoafId(id);
    try {
      await downloadFile(`/admin/pld/suspeitas/${id}/relatorio-coaf.pdf`, `coaf-sar-${id}.pdf`);
    } finally {
      setDownloadingCoafId(null);
    }
  };

  const downloadCvmReport = async () => {
    setDownloadingCvm(true);
    try {
      await downloadFile(`/admin/regulatorio/cvm-informe.pdf?period=${cvmPeriod}`, `cvm-informe-${cvmPeriod}.pdf`);
    } finally {
      setDownloadingCvm(false);
    }
  };

  const runBackupNow = async () => {
    setRunningBackup(true);
    try {
      await api.post('/admin/backups/run');
      await loadBackups();
    } catch {
      // surfaced via the list simply not gaining a new entry
    } finally {
      setRunningBackup(false);
    }
  };

  const confirmarTed = async (referencia: string) => {
    setConfirmingTed(referencia);
    try {
      await api.post(`/admin/ted/${referencia}/confirmar`);
      await loadTedPendentes();
      await loadAudit();
    } finally {
      setConfirmingTed(null);
    }
  };

  const saveFeePct = async () => {
    const n = Number(feePctInput);
    if (!Number.isFinite(n) || n < 0 || n > 50) return;
    setSavingFeePct(true);
    try {
      await api.put('/admin/juridico/cobranca-fee', { feePct: n });
      await loadFeeConfig();
      await loadAudit();
    } finally {
      setSavingFeePct(false);
    }
  };

  const recoverDuplicata = async (duplicataId: string) => {
    setRecoveringId(duplicataId);
    setRecoveryError((prev) => ({ ...prev, [duplicataId]: '' }));
    try {
      const raw = recoveredValorInput[duplicataId]?.trim();
      const valorRecuperado = raw ? Number(raw.replace(/\./g, '').replace(',', '.')) : undefined;
      await api.post(`/admin/juridico/cobranca/${duplicataId}/recuperar`, valorRecuperado ? { valorRecuperado } : undefined);
      await loadCobrancaJuridica();
      await loadRecoveries();
      await loadAudit();
    } catch (err) {
      setRecoveryError((prev) => ({ ...prev, [duplicataId]: err instanceof ApiError ? err.message : 'Não foi possível registrar a recuperação.' }));
    } finally {
      setRecoveringId(null);
    }
  };

  const generateCollectionDoc = async (duplicataId: string, tipo: string) => {
    const key = `${duplicataId}:${tipo}`;
    setGeneratingCollection(key);
    setCollectionError((prev) => ({ ...prev, [key]: '' }));
    try {
      await api.post(`/admin/juridico/cobranca/${duplicataId}/${tipo}`);
      await loadCobrancaJuridica();
      await loadAudit();
    } catch (err) {
      setCollectionError((prev) => ({ ...prev, [key]: err instanceof ApiError ? err.message : 'Não foi possível gerar o documento.' }));
    } finally {
      setGeneratingCollection(null);
    }
  };

  const reviewCollectionDoc = async (id: number) => {
    await api.post(`/admin/juridico/documentos/${id}/revisar`);
    await loadCobrancaJuridica();
    await loadAudit();
  };

  const reviewMinuta = async (id: number) => {
    await api.post(`/admin/juridico/documentos/${id}/revisar`);
    await loadMinutas();
    await loadAudit();
  };

  const submitMinuta = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!minutaContext.trim()) return;
    setGeneratingMinuta(true);
    setMinutaError('');
    try {
      await api.post('/admin/juridico/minutas', { type: minutaType, context: minutaContext.trim() });
      setMinutaContext('');
      await loadMinutas();
      await loadAudit();
    } catch (err) {
      setMinutaError(err instanceof ApiError ? err.message : 'Não foi possível gerar a minuta.');
    } finally {
      setGeneratingMinuta(false);
    }
  };

  const submitRegulatory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regTitle.trim() || !regText.trim()) return;
    setAnalyzingReg(true);
    setRegError('');
    try {
      await api.post('/admin/juridico/regulatorio', { title: regTitle.trim(), sourceText: regText.trim() });
      setRegTitle('');
      setRegText('');
      await loadRegulatorio();
      await loadAudit();
    } catch (err) {
      setRegError(err instanceof ApiError ? err.message : 'Não foi possível analisar o texto.');
    } finally {
      setAnalyzingReg(false);
    }
  };

  const acknowledgeRegulatory = async (id: number) => {
    await api.post(`/admin/juridico/regulatorio/${id}/reconhecer`);
    await loadRegulatorio();
    await loadAudit();
  };

  const saveThreshold = async () => {
    const n = Number(thresholdInput);
    if (!Number.isInteger(n) || n < 1 || n > 100) return;
    setSavingThreshold(true);
    try {
      await api.put('/admin/compliance-threshold', { threshold: n });
      await loadThreshold();
      await loadAudit();
    } finally {
      setSavingThreshold(false);
    }
  };

  const decideCompliance = async (duplicataId: string, decision: 'liberado' | 'rejeitado') => {
    const note = complianceNoteById[duplicataId]?.trim();
    if (!note) return;
    await api.post(`/admin/compliance-queue/${duplicataId}/decidir`, { decision, note });
    loadCompliance();
    loadAudit();
  };

  const approve = async (userId: number) => {
    await api.post(`/admin/kyb/${userId}/approve`);
    loadKyb();
    loadAudit();
  };

  const reject = async (userId: number) => {
    if (!rejectReason.trim()) return;
    await api.post(`/admin/kyb/${userId}/reject`, { reason: rejectReason.trim() });
    setRejectingId(null);
    setRejectReason('');
    loadKyb();
    loadAudit();
  };

  const decideAiTriage = async (pendingActionId: number, action: 'approve' | 'reject') => {
    setDecidingTriageId(pendingActionId);
    try {
      await api.post(`/agents/pending/${pendingActionId}/${action}`, {});
      await loadKyb();
    } finally {
      setDecidingTriageId(null);
    }
  };

  const loadForeignScreenings = (userId: number) =>
    api.get<{ screenings: ForeignInvestorScreening[] }>(`/admin/kyb/${userId}/elegibilidade-estrangeiro`).then((d) => {
      setForeignScreeningsById((prev) => ({ ...prev, [userId]: d.screenings }));
    });

  const generateForeignMemo = async (userId: number) => {
    setGeneratingMemoId(userId);
    try {
      await api.post(`/admin/kyb/${userId}/elegibilidade-estrangeiro/gerar`);
      await loadForeignScreenings(userId);
      await loadAudit();
    } finally {
      setGeneratingMemoId(null);
    }
  };

  const arbitrate = async (id: number, decision: 'cedente' | 'sacado') => {
    const note = noteById[id]?.trim();
    if (!note) return;
    await api.post(`/admin/disputes/${id}/resolve`, { decision, note });
    loadDisputes();
    loadAudit();
  };

  const generateAiSummary = async (id: number) => {
    setLoadingAiId(id);
    try {
      const res = await api.get<{ summary: { recommendation: string; reasoning: string } | null }>(`/admin/disputes/${id}/ai-summary`);
      setAiSummaryById((prev) => ({ ...prev, [id]: res.summary }));
    } finally {
      setLoadingAiId(null);
    }
  };

  return (
    <div>
      <PageHeader title="Back-office" subtitle="Aprovação de credenciamento, arbitragem de disputas e trilha de auditoria da plataforma" />

      <div className="flex gap-1 mb-5 p-1 rounded-lg bg-bg w-fit">
        {([
          ['kyb', `Fila de KYB (${pending.length})`],
          ['disputas', `Disputas (${disputes.length})`],
          ['compliance', `Compliance (${complianceQueue.length})`],
          ['juridico', 'Jurídico'],
          ['ia', 'Uso de IA'],
          ['agentes', 'Agentes IA'],
          ['flags', 'Feature flags'],
          ['auditoria', 'Auditoria'],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className="px-4 py-2 rounded-md text-[13px] font-bold cursor-pointer"
            style={{ background: tab === key ? '#fff' : 'transparent', color: tab === key ? '#0B1F3A' : '#5B6472' }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'kyb' && (
        <div className="flex flex-col gap-4">
          {pending.map((p) => (
            <div key={p.id} className="bg-white border border-border rounded-card p-6">
              <div className="flex justify-between items-start flex-wrap gap-2.5 mb-3">
                <div>
                  <div className="font-bold text-[16px]">{p.companyName}</div>
                  <div className="text-textSecondary text-[13px]">
                    {p.nome} · {p.email}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {p.naoResidente && (
                    <span className="text-[11.5px] font-bold px-3 py-1.5 rounded-md" style={{ background: '#E9EEFB', color: '#1E5EFF' }}>
                      Investidor não residente
                    </span>
                  )}
                  <span className="text-[11.5px] font-bold px-3 py-1.5 rounded-md bg-amberBg text-amber">Aguardando análise — {p.submittedAt}</span>
                </div>
              </div>
              {p.pldStatus === 'flagged' && (
                <div className="rounded-[10px] px-4 py-3 mb-3 text-[12.5px]" style={{ background: '#F7E9E7', color: '#B3261E' }}>
                  <b>PLD/FT — possível correspondência (lista de demonstração)</b>
                  <div className="mt-0.5">{p.pldMatchNote}</div>
                </div>
              )}
              {p.naoResidente ? (
                <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                  <div className="text-[13px]">
                    <div className="text-textTertiary text-[11.5px] uppercase font-bold mb-1">País de domicílio</div>
                    {p.kybForm.paisDomicilio || '—'}
                  </div>
                  <div className="text-[13px]">
                    <div className="text-textTertiary text-[11.5px] uppercase font-bold mb-1">ID fiscal estrangeiro</div>
                    {p.kybForm.taxIdEstrangeiro || '—'}
                  </div>
                  <div className="text-[13px]">
                    <div className="text-textTertiary text-[11.5px] uppercase font-bold mb-1">Representante no Brasil</div>
                    {p.kybForm.representanteLegal || '—'}
                  </div>
                </div>
              ) : (
                <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                  <div className="text-[13px]">
                    <div className="text-textTertiary text-[11.5px] uppercase font-bold mb-1">CNPJ</div>
                    {p.kybForm.cnpj || '—'}
                  </div>
                  <div className="text-[13px]">
                    <div className="text-textTertiary text-[11.5px] uppercase font-bold mb-1">Tipo</div>
                    {p.kybForm.tipo || '—'}
                  </div>
                  <div className="text-[13px]">
                    <div className="text-textTertiary text-[11.5px] uppercase font-bold mb-1">PL para alocação</div>
                    R$ {p.kybForm.pl || '—'}
                  </div>
                </div>
              )}

              {p.aiTriage && (
                <div className="rounded-[10px] p-4 mb-4" style={{ background: '#EEF3FF' }}>
                  <div className="flex items-center justify-between mb-1.5 flex-wrap gap-2">
                    <div className="font-bold text-[13px] flex items-center gap-2">
                      Pré-triagem do Agente de Onboarding (IA)
                      <span className="px-2 py-0.5 rounded-md text-[10.5px] font-bold bg-white text-blue">{p.aiTriage.status}</span>
                    </div>
                  </div>
                  <div className="text-[12.5px] text-textSecondary whitespace-pre-wrap">{p.aiTriage.summary || 'Investigação em andamento…'}</div>
                  {p.aiTriage.pendingActionId && (
                    <div className="flex items-center gap-2 mt-3">
                      <span className="text-[12px] font-bold">
                        A IA recomenda: {p.aiTriage.pendingActionTool === 'aprovar_kyb' ? 'aprovar' : 'rejeitar'} — confirmar?
                      </span>
                      <Button size="sm" disabled={decidingTriageId === p.aiTriage.pendingActionId} onClick={() => decideAiTriage(p.aiTriage!.pendingActionId!, 'approve')}>
                        Confirmar recomendação
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={decidingTriageId === p.aiTriage.pendingActionId}
                        onClick={() => decideAiTriage(p.aiTriage!.pendingActionId!, 'reject')}
                      >
                        Ignorar
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {p.naoResidente && (
                <div className="rounded-[10px] p-4 mb-4 bg-bg">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-bold text-[13px]">Memorando de elegibilidade — investidor não residente</div>
                    <Button size="sm" variant="secondary" disabled={generatingMemoId === p.id} onClick={() => generateForeignMemo(p.id)}>
                      {generatingMemoId === p.id ? 'Gerando…' : 'Gerar memorando'}
                    </Button>
                  </div>
                  {(foreignScreeningsById[p.id] ?? []).length === 0 ? (
                    <div className="text-[12.5px] text-textSecondary">Nenhum memorando gerado ainda para este investidor.</div>
                  ) : (
                    <div className="flex flex-col gap-2.5">
                      {foreignScreeningsById[p.id].slice(0, 3).map((s) => (
                        <div key={s.id} className="bg-white border border-border rounded-[10px] p-3.5">
                          <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span
                                className="text-[11px] font-bold px-2.5 py-1 rounded-md"
                                style={
                                  s.classificacao === 'profissional' ? { background: '#EAF3EE', color: '#0A5C36' } : { background: '#F0F2F5', color: '#5B6472' }
                                }
                              >
                                {s.classificacao === 'profissional' ? 'Investidor profissional' : 'Não classificado'}
                              </span>
                              <span
                                className="text-[11px] font-bold px-2.5 py-1 rounded-md"
                                style={s.jurisdicaoFavorecida ? { background: '#F7E9E7', color: '#B03A2E' } : { background: '#EAF3EE', color: '#0A5C36' }}
                              >
                                {s.jurisdicaoFavorecida ? 'Jurisdição de tributação favorecida' : 'IRRF zero elegível (sujeito a confirmação jurídica)'}
                              </span>
                              <span
                                className="text-[11px] font-bold px-2.5 py-1 rounded-md"
                                style={s.pldStatus === 'flagged' ? { background: '#F7E9E7', color: '#B03A2E' } : { background: '#EAF3EE', color: '#0A5C36' }}
                              >
                                PLD: {s.pldStatus === 'flagged' ? 'correspondência encontrada' : 'sem correspondência'}
                              </span>
                            </div>
                            <span className="text-[11px] text-textTertiary">{s.quando}</span>
                          </div>
                          <pre className="text-[11.5px] text-textSecondary whitespace-pre-wrap font-sans leading-relaxed">{s.memo}</pre>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {rejectingId === p.id ? (
                <div className="flex items-center gap-2.5 flex-wrap">
                  <input
                    className="flex-1 min-w-[220px] px-3 py-2 rounded-md border border-inputBorder text-[13px]"
                    placeholder="Motivo da rejeição"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                  />
                  <Button size="sm" variant="danger" onClick={() => reject(p.id)}>
                    Confirmar rejeição
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRejectingId(null)}>
                    Cancelar
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2.5">
                  <Button size="sm" variant="success" onClick={() => approve(p.id)}>
                    Aprovar credenciamento
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setRejectingId(p.id)}>
                    Rejeitar
                  </Button>
                </div>
              )}
            </div>
          ))}
          {pending.length === 0 && (
            <div className="bg-white border border-border rounded-card">
              <EmptyState title="Nenhum credenciamento pendente" hint="Novas solicitações de investidores institucionais aparecem aqui" />
            </div>
          )}
        </div>
      )}

      {tab === 'disputas' && (
        <div className="flex flex-col gap-4">
          {disputes.map((d) => (
            <div key={d.id} className="bg-white border border-border rounded-card p-6">
              <div className="flex justify-between items-start flex-wrap gap-2.5 mb-3">
                <div>
                  <div className="font-mono-num font-bold text-[13px] text-textSecondary">{d.duplicataId}</div>
                  <div className="font-bold text-[16px] mt-1">
                    {d.cedente} vs {d.sacado} — {d.valorFmt}
                  </div>
                </div>
              </div>
              <div className="rounded-[10px] px-4 py-3.5 mb-3 bg-amberBg text-sm">{d.motivo}</div>
              <div className="flex flex-col gap-2 mb-3.5">
                {d.timeline.map((t, i) => (
                  <div key={i} className="text-[13px]">
                    <b>{t.autor}</b> {t.texto} <span className="text-textMuted">— {t.quando}</span>
                  </div>
                ))}
              </div>
              {aiSummaryById[d.id] === undefined ? (
                <Button size="sm" variant="secondary" className="mb-3.5" disabled={loadingAiId === d.id} onClick={() => generateAiSummary(d.id)}>
                  {loadingAiId === d.id ? 'Analisando…' : 'Gerar análise da IA (sugestão, não decide sozinha)'}
                </Button>
              ) : aiSummaryById[d.id] ? (
                <div className="rounded-[10px] px-4 py-3.5 mb-3.5 bg-chip text-[13px]">
                  <div className="font-bold text-blue mb-1">
                    IA sugere: {aiSummaryById[d.id]!.recommendation === 'cedente' ? 'favor do cedente' : aiSummaryById[d.id]!.recommendation === 'sacado' ? 'favor do sacado' : 'inconclusivo — precisa de mais evidência'}
                  </div>
                  <div className="text-textSecondary">{aiSummaryById[d.id]!.reasoning}</div>
                </div>
              ) : (
                <div className="text-[12.5px] text-textSecondary mb-3.5">Análise indisponível (ANTHROPIC_API_KEY não configurada no servidor).</div>
              )}
              <div className="flex items-center gap-2.5 flex-wrap">
                <input
                  className="flex-1 min-w-[220px] px-3 py-2 rounded-md border border-inputBorder text-[13px]"
                  placeholder="Nota da decisão de arbitragem"
                  value={noteById[d.id] ?? ''}
                  onChange={(e) => setNoteById((prev) => ({ ...prev, [d.id]: e.target.value }))}
                />
                <Button size="sm" variant="success" onClick={() => arbitrate(d.id, 'cedente')}>
                  Decidir a favor do cedente
                </Button>
                <Button size="sm" variant="danger" onClick={() => arbitrate(d.id, 'sacado')}>
                  Decidir a favor do sacado
                </Button>
              </div>
            </div>
          ))}
          {disputes.length === 0 && (
            <div className="bg-white border border-border rounded-card">
              <EmptyState title="Nenhuma disputa em aberto" hint="Disputas escaladas pelo cedente aparecem aqui para arbitragem" />
            </div>
          )}
        </div>
      )}

      {tab === 'compliance' && (
        <div className="flex flex-col gap-4">
          <div className="text-textSecondary text-[12.5px]">
            Duplicatas suspensas automaticamente pelo Compliance AI Engine (nota de risco ≥ {threshold?.threshold ?? 80}/100) antes de chegar ao
            marketplace. Nenhuma é bloqueada para sempre sem revisão — libere ou rejeite abaixo.
          </div>

          <div className="bg-white border border-border rounded-card p-5">
            <div className="font-bold text-[14px] mb-1">Nota de corte para suspensão automática</div>
            <div className="text-textSecondary text-[12.5px] mb-3">
              Duplicatas com nota igual ou acima deste valor vão para a fila de revisão humana em vez de seguir direto para o marketplace. Padrão:{' '}
              {threshold?.default ?? 80}.
            </div>
            <div className="flex items-center gap-2.5">
              <input
                type="number"
                min={1}
                max={100}
                className="w-24 px-3 py-2 rounded-md border border-inputBorder text-[13px]"
                value={thresholdInput}
                onChange={(e) => setThresholdInput(e.target.value)}
              />
              <Button size="sm" variant="secondary" disabled={savingThreshold || Number(thresholdInput) === threshold?.threshold} onClick={saveThreshold}>
                {savingThreshold ? 'Salvando…' : 'Salvar'}
              </Button>
            </div>
          </div>

          {complianceQueue.map((c) => (
            <div key={c.duplicataId} className="bg-white rounded-card p-6" style={{ border: '1px solid #E9CFCB' }}>
              <div className="flex justify-between items-start flex-wrap gap-2.5 mb-3">
                <div>
                  <div className="font-mono-num font-bold text-[13px] text-textSecondary">{c.duplicataId}</div>
                  <div className="font-bold text-[16px] mt-1">
                    {c.cedente} → {c.sacado} — {c.valorFmt}
                  </div>
                  <div className="text-textSecondary text-[12.5px] mt-1">Vencimento {c.vencimento} · suspensa {c.quando}</div>
                </div>
                <span className="text-[11.5px] font-bold px-3 py-1.5 rounded-md bg-amberBg text-amber">Nota de risco: {c.score}/100</span>
              </div>
              <div className="flex flex-col gap-1.5 mb-3">
                {c.breakdown.map((b, i) => (
                  <div key={i} className="text-[12.5px] text-textSecondary">
                    <b className="text-textPrimary">
                      {b.fator} (+{b.pontos})
                    </b>{' '}
                    — {b.detalhe}
                  </div>
                ))}
              </div>
              <div className="rounded-[10px] px-4 py-3.5 mb-3.5 bg-chip text-[13px]">
                <div className="font-bold text-blue mb-1">Explicação da IA</div>
                <div className="text-textSecondary">{c.reasoning}</div>
              </div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <input
                  className="flex-1 min-w-[220px] px-3 py-2 rounded-md border border-inputBorder text-[13px]"
                  placeholder="Nota da decisão de revisão"
                  value={complianceNoteById[c.duplicataId] ?? ''}
                  onChange={(e) => setComplianceNoteById((prev) => ({ ...prev, [c.duplicataId]: e.target.value }))}
                />
                <Button size="sm" variant="success" onClick={() => decideCompliance(c.duplicataId, 'liberado')}>
                  Liberar para leilão
                </Button>
                <Button size="sm" variant="danger" onClick={() => decideCompliance(c.duplicataId, 'rejeitado')}>
                  Rejeitar
                </Button>
              </div>
            </div>
          ))}
          {complianceQueue.length === 0 && (
            <div className="bg-white border border-border rounded-card">
              <EmptyState title="Nenhuma duplicata em revisão de compliance" hint="Duplicatas com nota de risco alta aparecem aqui automaticamente" />
            </div>
          )}

          <div className="bg-white border border-border rounded-card p-5 mt-2">
            <div className="flex items-center justify-between mb-1">
              <div className="font-bold text-[14px]">Monitor de atividade suspeita (PLD)</div>
              <Button size="sm" variant="secondary" disabled={scanningSar} onClick={runSarScan}>
                {scanningSar ? 'Varrendo…' : 'Rodar varredura agora'}
              </Button>
            </div>
            <div className="text-textSecondary text-[12.5px] mb-3">
              Detecção automática (fracionamento, entrada/saída rápida) sobre o extrato real — varredura a cada 6h. Não há envio automático ao COAF: um
              real reporte via SISCOAP exige credenciais de instituição licenciada que este ambiente não tem, então cada caso é revisado por um admin.
            </div>
            <div className="flex items-center gap-2.5 mb-4">
              <span className="text-[12.5px] font-semibold text-textSecondary">Limite de fracionamento (24h):</span>
              <input
                type="number"
                min={1000}
                className="w-32 px-3 py-2 rounded-md border border-inputBorder text-[13px]"
                value={sarThresholdInput}
                onChange={(e) => setSarThresholdInput(e.target.value)}
              />
              <Button size="sm" variant="secondary" disabled={savingSarThreshold || Number(sarThresholdInput) === sarThreshold} onClick={saveSarThreshold}>
                {savingSarThreshold ? 'Salvando…' : 'Salvar'}
              </Button>
            </div>

            {sarReports.map((s) => (
              <div key={s.id} className="rounded-[10px] p-4 mb-3 last:mb-0" style={{ border: `1px solid ${s.severidade === 'critico' ? '#E9CFCB' : '#E4E8EE'}` }}>
                <div className="flex items-start justify-between gap-2.5 mb-2">
                  <div>
                    <div className="font-bold text-[13.5px]">
                      {s.empresa} <span className="font-normal text-textMuted">— {SAR_TIPO_LABELS[s.tipo] ?? s.tipo}</span>
                    </div>
                    <div className="text-textSecondary text-[12.5px] mt-1">{s.descricao}</div>
                    <div className="text-textTertiary text-[11px] mt-1">{s.quando}</div>
                  </div>
                  <span
                    className="text-[11px] font-bold px-2.5 py-1 rounded-md whitespace-nowrap"
                    style={s.severidade === 'critico' ? { background: '#F7E9E7', color: '#B03A2E' } : { background: '#FBF1E0', color: '#8A6116' }}
                  >
                    {s.severidade === 'critico' ? 'Crítico' : 'Atenção'}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    className="flex-1 min-w-[200px] px-3 py-2 rounded-md border border-inputBorder text-[12.5px]"
                    placeholder="Protocolo COAF (após reportar externamente)"
                    value={sarExternalRefById[s.id] ?? ''}
                    onChange={(e) => setSarExternalRefById((prev) => ({ ...prev, [s.id]: e.target.value }))}
                  />
                  <Button size="sm" variant="success" disabled={sarActionId === s.id || !(sarExternalRefById[s.id] ?? '').trim()} onClick={() => reportSarToCoaf(s.id)}>
                    Marcar como reportado
                  </Button>
                  <Button size="sm" variant="ghost" disabled={sarActionId === s.id} onClick={() => dismissSar(s.id)}>
                    Descartar
                  </Button>
                  <Button size="sm" variant="ghost" disabled={downloadingCoafId === s.id} onClick={() => downloadCoafReport(s.id)}>
                    {downloadingCoafId === s.id ? 'Gerando…' : 'Relatório COAF (PDF)'}
                  </Button>
                </div>
              </div>
            ))}
            {sarReports.length === 0 && <EmptyState title="Nenhuma atividade suspeita em aberto" hint="Padrões de fracionamento ou passagem rápida de recursos aparecem aqui" />}
          </div>

          <div className="bg-white border border-border rounded-card p-5 mt-4">
            <div className="font-bold text-[14px] mb-1">Informe mensal de atividade (CVM)</div>
            <div className="text-textSecondary text-[12.5px] mb-3">
              Agregados reais de emissão, negociação primária/secundária, sinistros e SARs — documento de apoio a compliance, não um protocolo formal
              junto à CVM.
            </div>
            <div className="flex items-center gap-2.5">
              <input
                type="month"
                className="px-3 py-2 rounded-md border border-inputBorder text-[13px]"
                value={cvmPeriod}
                onChange={(e) => setCvmPeriod(e.target.value)}
              />
              <Button size="sm" variant="secondary" disabled={downloadingCvm} onClick={downloadCvmReport}>
                {downloadingCvm ? 'Gerando…' : 'Baixar informe (PDF)'}
              </Button>
            </div>
          </div>

          <div className="bg-white border border-border rounded-card p-5 mt-4">
            <div className="flex items-center justify-between mb-1">
              <div className="font-bold text-[14px]">Fundo de garantia — acionamentos em aberto</div>
              <span className="text-[12.5px] font-bold text-textSecondary">Saldo do fundo: {fundBalanceFmt || '—'}</span>
            </div>
            <div className="text-textSecondary text-[12.5px] mb-3">
              Cobre defaults em duplicatas sem seguro contratado, alimentado por 10% da taxa de plataforma — nunca um custo extra ao cedente ou
              investidor. Pagamento aprovado é limitado a 80% do valor solicitado e ao saldo real disponível.
            </div>
            {fundClaims.map((c) => (
              <div key={c.id} className="rounded-[10px] p-4 mb-3 last:mb-0 border border-border">
                <div className="flex items-start justify-between gap-2.5 mb-2">
                  <div>
                    <div className="font-bold text-[13.5px]">
                      {c.investidor} <span className="font-normal text-textMuted">— {c.sacado} ({c.duplicataId})</span>
                    </div>
                    <div className="text-textSecondary text-[12.5px] mt-1">Solicitado: {c.valorSolicitadoFmt}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    className="flex-1 min-w-[220px] px-3 py-2 rounded-md border border-inputBorder text-[12.5px]"
                    placeholder="Justificativa da decisão"
                    value={fundNoteById[c.id] ?? ''}
                    onChange={(e) => setFundNoteById((prev) => ({ ...prev, [c.id]: e.target.value }))}
                  />
                  <Button
                    size="sm"
                    variant="success"
                    disabled={decidingFundClaimId === c.id || !(fundNoteById[c.id] ?? '').trim()}
                    onClick={() => decideFundClaim(c.id, 'aprovado')}
                  >
                    Aprovar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={decidingFundClaimId === c.id || !(fundNoteById[c.id] ?? '').trim()}
                    onClick={() => decideFundClaim(c.id, 'negado')}
                  >
                    Negar
                  </Button>
                </div>
              </div>
            ))}
            {fundClaims.length === 0 && <EmptyState title="Nenhum acionamento em aberto" hint="Solicitações do fundo de garantia aparecem aqui" />}
          </div>

          <div className="bg-white border border-border rounded-card p-5 mt-4">
            <div className="flex items-center justify-between mb-1">
              <div className="font-bold text-[14px]">Fundo de garantia — teste de estresse (Monte Carlo)</div>
              <Button size="sm" variant="secondary" disabled={runningStress} onClick={runStressTest}>
                {runningStress ? 'Simulando…' : 'Executar simulação'}
              </Button>
            </div>
            <div className="text-textSecondary text-[12.5px] mb-3">
              Simula a exposição real atual (posições ativas sem seguro) milhares de vezes contra um choque macro comum correlacionado — um
              fator único (mesma ideia estrutural do modelo de Vasicek), não flips independentes ingênuos. Sem modelo de ML treinado, a
              probabilidade de default por posição usa uma premissa assumida por rating (documentada em lib/guaranteeFundStressTest.ts), nunca
              apresentada como histórico real medido.
            </div>
            {stressResult ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-md border border-border p-3">
                  <div className="text-[11px] font-bold text-textSecondary uppercase mb-1">P(esgotamento)</div>
                  <div className="font-mono-num font-bold text-[15px]" style={{ color: stressResult.pDepletion > 0.05 ? '#B03A2E' : '#0A5C36' }}>
                    {(stressResult.pDepletion * 100).toFixed(2)}%
                  </div>
                </div>
                <div className="rounded-md border border-border p-3">
                  <div className="text-[11px] font-bold text-textSecondary uppercase mb-1">Perda esperada</div>
                  <div className="font-mono-num font-bold text-[15px]">{stressResult.expectedLossFmt}</div>
                </div>
                <div className="rounded-md border border-border p-3">
                  <div className="text-[11px] font-bold text-textSecondary uppercase mb-1">VaR 95% / 99%</div>
                  <div className="font-mono-num font-bold text-[13px]">
                    {stressResult.var95Fmt} / {stressResult.var99Fmt}
                  </div>
                </div>
                <div className="rounded-md border border-border p-3">
                  <div className="text-[11px] font-bold text-textSecondary uppercase mb-1">Shortfall esperado</div>
                  <div className="font-mono-num font-bold text-[15px]">{stressResult.expectedShortfallFmt}</div>
                </div>
                <div className="col-span-2 md:col-span-4 text-[11.5px] text-textSecondary">
                  {stressResult.simulations.toLocaleString('pt-BR')} simulações · correlação {(stressResult.correlation * 100).toFixed(0)}% ·
                  exposição real {stressResult.exposureTotalFmt} em {stressResult.exposureCount} posições · saldo do fundo{' '}
                  {stressResult.fundBalanceFmt} · {stressResult.usingMlModel ? 'usando modelo de ML treinado' : 'usando premissa assumida por rating (sem modelo de ML treinado ainda)'}
                </div>
              </div>
            ) : (
              <EmptyState title="Nenhuma simulação executada ainda" hint="Clique em “Executar simulação” para rodar o Monte Carlo" />
            )}
          </div>
        </div>
      )}

      {tab === 'juridico' && (
        <div>
          <div className="flex gap-1 mb-4 p-1 rounded-lg bg-bg w-fit">
            {([
              ['cobranca', 'Cobrança Jurídica'],
              ['minutas', 'Minutas'],
              ['regulatorio', 'Regulatório'],
            ] as [LegalSubTab, string][]).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setLegalSubTab(key)}
                className="px-3.5 py-1.5 rounded-md text-[12.5px] font-bold cursor-pointer"
                style={{ background: legalSubTab === key ? '#fff' : 'transparent', color: legalSubTab === key ? '#0B1F3A' : '#5B6472' }}
              >
                {label}
              </button>
            ))}
          </div>

          {legalSubTab === 'cobranca' && (
            <div className="flex flex-col gap-4">
              <div className="rounded-[10px] px-4 py-3 text-[12.5px]" style={{ background: '#FBF1E0', color: '#8A5A0A' }}>
                <b>Toda minuta é um rascunho.</b> {legalDisclaimer}
              </div>

              <div className="bg-white border border-border rounded-card p-5">
                <div className="font-bold text-[14px] mb-1">Fee de sucesso sobre valor recuperado</div>
                <div className="text-textSecondary text-[12.5px] mb-3">
                  Cobrado do credor atual (cedente, ou investidor se a duplicata foi vendida) apenas quando uma cobrança jurídica resulta em pagamento.
                  Padrão: {feeConfig?.default ?? 5}%.
                </div>
                <div className="flex items-center gap-2.5">
                  <input
                    type="number"
                    min={0}
                    max={50}
                    step={0.5}
                    className="w-24 px-3 py-2 rounded-md border border-inputBorder text-[13px]"
                    value={feePctInput}
                    onChange={(e) => setFeePctInput(e.target.value)}
                  />
                  <span className="text-[13px] text-textSecondary">%</span>
                  <Button size="sm" variant="secondary" disabled={savingFeePct || Number(feePctInput) === feeConfig?.feePct} onClick={saveFeePct}>
                    {savingFeePct ? 'Salvando…' : 'Salvar'}
                  </Button>
                </div>
              </div>

              {overdue.map((o) => (
                <div key={o.duplicataId} className="bg-white border border-border rounded-card p-6">
                  <div className="flex justify-between items-start flex-wrap gap-2.5 mb-3">
                    <div>
                      <div className="font-mono-num font-bold text-[13px] text-textSecondary">{o.duplicataId}</div>
                      <div className="font-bold text-[16px] mt-1">
                        {o.cedente} → {o.sacado} — {o.valorFmt}
                      </div>
                      <div className="text-textSecondary text-[12.5px] mt-1">
                        Vencimento {o.vencimento} · {o.diasEmAtraso} dia(s) em atraso
                      </div>
                    </div>
                    {o.eligible ? (
                      <span className="text-[11.5px] font-bold px-3 py-1.5 rounded-md" style={{ background: '#F7E9E7', color: '#B3261E' }}>
                        Elegível para escalar
                      </span>
                    ) : (
                      <span className="text-[11.5px] font-bold px-3 py-1.5 rounded-md bg-bg text-textSecondary">Não elegível</span>
                    )}
                  </div>
                  {!o.eligible && o.reason && <div className="text-[12.5px] text-textSecondary mb-3">{o.reason}</div>}
                  {o.eligible && (
                    <div className="flex items-center gap-2 flex-wrap mb-3">
                      {(['notificacao_cobranca', 'minuta_protesto', 'peticao_execucao'] as const).map((tipoDoc) => {
                        const key = `${o.duplicataId}:${tipoDoc}`;
                        return (
                          <Button
                            key={tipoDoc}
                            size="sm"
                            variant="secondary"
                            disabled={generatingCollection === key}
                            onClick={() => generateCollectionDoc(o.duplicataId, tipoDoc)}
                          >
                            {generatingCollection === key ? 'Gerando…' : `Gerar ${COLLECTION_DOC_LABELS[tipoDoc]}`}
                          </Button>
                        );
                      })}
                    </div>
                  )}
                  {Object.entries(collectionError)
                    .filter(([k, msg]) => k.startsWith(`${o.duplicataId}:`) && msg)
                    .map(([k, msg]) => (
                      <div key={k} className="text-red text-[12px] font-semibold mb-2">
                        {msg}
                      </div>
                    ))}
                  {o.documentos.length > 0 && (
                    <div className="flex flex-col gap-2 mt-2">
                      {o.documentos.map((doc) => (
                        <details key={doc.id} className="rounded-[10px] bg-chip px-4 py-3">
                          <summary className="cursor-pointer text-[13px] font-bold flex items-center justify-between">
                            <span>
                              {COLLECTION_DOC_LABELS[doc.type] ?? doc.type} · {doc.quando}
                            </span>
                            <span
                              className="text-[11px] font-bold px-2 py-0.5 rounded-md ml-2"
                              style={doc.reviewed ? { background: '#EAF3EE', color: '#0A5C36' } : { background: '#FBF1E0', color: '#B8790A' }}
                            >
                              {doc.reviewed ? 'Revisado' : 'Aguardando revisão'}
                            </span>
                          </summary>
                          <pre className="whitespace-pre-wrap text-[12.5px] text-textSecondary mt-2 font-sans">{doc.content}</pre>
                          {!doc.reviewed && (
                            <Button size="sm" variant="success" className="mt-2" onClick={() => reviewCollectionDoc(doc.id)}>
                              Marcar como revisado por advogado
                            </Button>
                          )}
                        </details>
                      ))}
                    </div>
                  )}
                  {o.eligible && (
                    <div className="mt-3 pt-3 border-t border-hairline">
                      <div className="text-[12.5px] font-bold mb-1.5">Registrar recuperação (sacado pagou fora da plataforma)</div>
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <input
                          className="w-40 px-3 py-2 rounded-md border border-inputBorder text-[13px]"
                          placeholder={o.valorFmt}
                          value={recoveredValorInput[o.duplicataId] ?? ''}
                          onChange={(e) => setRecoveredValorInput((prev) => ({ ...prev, [o.duplicataId]: e.target.value }))}
                        />
                        <Button
                          size="sm"
                          variant="success"
                          disabled={recoveringId === o.duplicataId}
                          onClick={() => recoverDuplicata(o.duplicataId)}
                        >
                          {recoveringId === o.duplicataId ? 'Registrando…' : `Registrar recuperação (fee ${feeConfig?.feePct ?? 5}%)`}
                        </Button>
                      </div>
                      {recoveryError[o.duplicataId] && <div className="text-red text-[12px] font-semibold mt-1.5">{recoveryError[o.duplicataId]}</div>}
                    </div>
                  )}
                </div>
              ))}
              {overdue.length === 0 && (
                <div className="bg-white border border-border rounded-card">
                  <EmptyState title="Nenhuma duplicata vencida no momento" hint="Duplicatas vencidas elegíveis para cobrança jurídica aparecem aqui" />
                </div>
              )}

              <div className="bg-white border border-border rounded-card overflow-hidden">
                <div className="px-5 py-3.5 border-b border-border font-bold text-[14px]">Histórico de recuperações</div>
                {recoveries.map((r) => (
                  <div key={r.duplicataId} className="px-5 py-3 border-b border-[#F5F7FA] last:border-b-0 flex items-center justify-between gap-3 text-[13px]">
                    <div>
                      <div className="font-mono-num font-bold text-textSecondary">{r.duplicataId}</div>
                      <div className="text-textSecondary text-[12px]">
                        {r.cedente} → {r.sacado} · recuperado {r.recoveredValorFmt} · {r.quando}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold">
                        Fee {r.feeValorFmt} ({r.feePct}%)
                      </div>
                      <div className="text-textTertiary text-[11.5px]">debitado do {r.chargedRole === 'investidor' ? 'investidor' : 'cedente'}</div>
                    </div>
                  </div>
                ))}
                {recoveries.length === 0 && <EmptyState title="Nenhuma recuperação registrada ainda" hint="Recuperações registradas acima aparecem aqui, com o fee de sucesso cobrado" />}
              </div>
            </div>
          )}

          {legalSubTab === 'minutas' && (
            <div className="flex flex-col gap-4">
              <div className="rounded-[10px] px-4 py-3 text-[12.5px]" style={{ background: '#FBF1E0', color: '#8A5A0A' }}>
                Toda minuta é um rascunho gerado por IA — requer revisão de advogado antes de qualquer envio formal.
              </div>
              <form onSubmit={submitMinuta} className="bg-white border border-border rounded-card p-5 flex flex-col gap-2.5">
                <div className="font-bold text-[14px] mb-1">Gerar nova minuta</div>
                <select
                  className="px-3 py-2 rounded-md border border-inputBorder text-[13px] self-start"
                  value={minutaType}
                  onChange={(e) => setMinutaType(e.target.value as typeof minutaType)}
                >
                  <option value="resposta_lgpd">Resposta a titular (LGPD)</option>
                  <option value="termos_atualizacao">Atualização de termos</option>
                  <option value="notificacao_padrao">Notificação padrão</option>
                </select>
                <textarea
                  className="px-3 py-2 rounded-md border border-inputBorder text-[13px] min-h-[90px]"
                  placeholder="Descreva o contexto (ex.: solicitação do titular, resumo da mudança, motivo da notificação)"
                  value={minutaContext}
                  onChange={(e) => setMinutaContext(e.target.value)}
                />
                <Button type="submit" size="sm" className="self-start" disabled={generatingMinuta || !minutaContext.trim()}>
                  {generatingMinuta ? 'Gerando…' : 'Gerar minuta'}
                </Button>
                {minutaError && <div className="text-red text-[12px] font-semibold">{minutaError}</div>}
              </form>

              {minutas.map((doc) => (
                <details key={doc.id} className="bg-white border border-border rounded-card px-5 py-4">
                  <summary className="cursor-pointer text-[13px] font-bold flex items-center justify-between">
                    <span>
                      {MINUTA_TYPE_LABELS[doc.type] ?? doc.type} · {doc.quando}
                    </span>
                    <span
                      className="text-[11px] font-bold px-2 py-0.5 rounded-md ml-2"
                      style={doc.reviewed ? { background: '#EAF3EE', color: '#0A5C36' } : { background: '#FBF1E0', color: '#B8790A' }}
                    >
                      {doc.reviewed ? 'Revisado' : 'Aguardando revisão'}
                    </span>
                  </summary>
                  <pre className="whitespace-pre-wrap text-[12.5px] text-textSecondary mt-2 font-sans">{doc.content}</pre>
                  {!doc.reviewed && (
                    <Button size="sm" variant="success" className="mt-2" onClick={() => reviewMinuta(doc.id)}>
                      Marcar como revisado por advogado
                    </Button>
                  )}
                </details>
              ))}
              {minutas.length === 0 && (
                <div className="bg-white border border-border rounded-card">
                  <EmptyState title="Nenhuma minuta gerada ainda" hint="Minutas jurídicas geradas aparecem aqui" />
                </div>
              )}
            </div>
          )}

          {legalSubTab === 'regulatorio' && (
            <div className="flex flex-col gap-4">
              <div className="text-textSecondary text-[12.5px]">
                Cole o texto de um normativo (resolução BACEN, circular etc.) para a IA resumir e apontar áreas de impacto — não é um monitoramento
                automático, apenas análise do texto que você fornecer.
              </div>
              <form onSubmit={submitRegulatory} className="bg-white border border-border rounded-card p-5 flex flex-col gap-2.5">
                <input
                  className="px-3 py-2 rounded-md border border-inputBorder text-[13px]"
                  placeholder="Título/referência (ex.: Resolução BCB 540/2025)"
                  value={regTitle}
                  onChange={(e) => setRegTitle(e.target.value)}
                />
                <textarea
                  className="px-3 py-2 rounded-md border border-inputBorder text-[13px] min-h-[120px]"
                  placeholder="Cole o texto do normativo aqui"
                  value={regText}
                  onChange={(e) => setRegText(e.target.value)}
                />
                <Button type="submit" size="sm" className="self-start" disabled={analyzingReg || !regTitle.trim() || !regText.trim()}>
                  {analyzingReg ? 'Analisando…' : 'Analisar'}
                </Button>
                {regError && <div className="text-red text-[12px] font-semibold">{regError}</div>}
              </form>

              {regulatoryNotes.map((n) => (
                <div key={n.id} className="bg-white border border-border rounded-card p-5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-bold text-[14px]">{n.title}</div>
                    <span
                      className="text-[11.5px] font-bold px-2.5 py-1 rounded-md"
                      style={n.acknowledged ? { background: '#EAF3EE', color: '#0A5C36' } : { background: '#FBF1E0', color: '#B8790A' }}
                    >
                      {n.acknowledged ? 'Reconhecido' : 'Pendente'}
                    </span>
                  </div>
                  <div className="text-textSecondary text-[12.5px] mb-2">{n.summary}</div>
                  {n.impactAreas.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {n.impactAreas.map((a, i) => (
                        <span key={i} className="text-[11px] font-bold px-2 py-1 rounded-md bg-chip text-blue">
                          {a}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="rounded-[10px] px-3.5 py-2.5 bg-bg text-[12.5px] text-textSecondary mb-2">
                    <b className="text-textPrimary">Ações recomendadas: </b>
                    {n.recommendedActions}
                  </div>
                  <div className="text-textMuted text-[11.5px] mb-2">{n.quando}</div>
                  {!n.acknowledged && (
                    <Button size="sm" variant="secondary" onClick={() => acknowledgeRegulatory(n.id)}>
                      Marcar como reconhecido
                    </Button>
                  )}
                </div>
              ))}
              {regulatoryNotes.length === 0 && (
                <div className="bg-white border border-border rounded-card">
                  <EmptyState title="Nenhum normativo analisado ainda" hint="Cole o texto de uma resolução/circular acima para começar" />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'ia' && (
        <div className="flex flex-col gap-4">
          <div className="text-textSecondary text-[12.5px]">
            Custo é uma estimativa (taxa por token configurável no servidor) a partir dos tokens reais que a API da Anthropic retornou em cada chamada —
            útil para identificar qual recurso está gerando mais gasto, não é uma fatura. Cada rota que chama a IA também tem limite de 30 chamadas por
            usuário a cada 15 minutos.
          </div>

          {mlScoring && (
            <div className="bg-white border border-border rounded-card p-5">
              <div className="flex items-center justify-between flex-wrap gap-2.5 mb-2">
                <div className="font-bold text-[14px]">Score de crédito — modelo treinado (ML)</div>
                <Button size="sm" variant="secondary" disabled={retrainingMl} onClick={retrainMl}>
                  {retrainingMl ? 'Treinando…' : 'Retreinar agora'}
                </Button>
              </div>
              {mlScoring.model ? (
                <div className="text-[12.5px] text-textSecondary">
                  Treinado em {new Date(mlScoring.model.trainedAt).toLocaleString('pt-BR')} com {mlScoring.model.nSamples} amostras (
                  {mlScoring.model.nPositive} com resultado ruim) — acurácia de treino {(mlScoring.model.trainAccuracy * 100).toFixed(0)}%. Usado pelo
                  Agente de Underwriting (ferramenta <code>prever_probabilidade_ml</code>).
                </div>
              ) : (
                <div className="text-[12.5px] text-textSecondary">
                  Nenhum modelo treinado ainda — mínimo de {mlScoring.minTrainingSamples} duplicatas com resultado real (sinistro aprovado ou recuperação
                  jurídica) na base.
                </div>
              )}
              {mlRetrainMessage && <div className="text-[12px] font-bold text-blue mt-2">{mlRetrainMessage}</div>}
            </div>
          )}
          {aiUsage && (
            <>
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                <div className="bg-white border border-border rounded-card p-4">
                  <div className="text-textTertiary text-[11.5px] uppercase font-bold mb-1">Chamadas totais</div>
                  <div className="text-[22px] font-bold">{aiUsage.totalCalls}</div>
                  {aiUsage.failedCalls > 0 && <div className="text-[11.5px] text-red mt-0.5">{aiUsage.failedCalls} com falha</div>}
                </div>
                <div className="bg-white border border-border rounded-card p-4">
                  <div className="text-textTertiary text-[11.5px] uppercase font-bold mb-1">Tokens de entrada</div>
                  <div className="text-[22px] font-bold">{aiUsage.totalInputTokens.toLocaleString('pt-BR')}</div>
                </div>
                <div className="bg-white border border-border rounded-card p-4">
                  <div className="text-textTertiary text-[11.5px] uppercase font-bold mb-1">Tokens de saída</div>
                  <div className="text-[22px] font-bold">{aiUsage.totalOutputTokens.toLocaleString('pt-BR')}</div>
                </div>
                <div className="bg-white border border-border rounded-card p-4">
                  <div className="text-textTertiary text-[11.5px] uppercase font-bold mb-1">Custo estimado</div>
                  <div className="text-[22px] font-bold">US$ {aiUsage.totalEstimatedCostUsd.toFixed(2)}</div>
                </div>
              </div>

              <div className="bg-white border border-border rounded-card overflow-hidden">
                <div className="px-5 py-3.5 border-b border-border font-bold text-[14px]">Por recurso</div>
                {aiUsage.byFeature.map((f) => (
                  <div key={f.feature} className="px-5 py-3 border-b border-[#F5F7FA] last:border-b-0 flex items-center justify-between gap-3 text-[13px]">
                    <div className="font-bold">{FEATURE_LABELS[f.feature] ?? f.feature}</div>
                    <div className="text-textSecondary flex items-center gap-4">
                      <span>{f.calls} chamadas</span>
                      <span>
                        {f.inputTokens.toLocaleString('pt-BR')} / {f.outputTokens.toLocaleString('pt-BR')} tok
                      </span>
                      <span className="font-mono-num font-bold text-textPrimary">US$ {f.estimatedCostUsd.toFixed(3)}</span>
                    </div>
                  </div>
                ))}
                {aiUsage.byFeature.length === 0 && <EmptyState title="Nenhuma chamada de IA registrada ainda" hint="Cada recurso assistido por IA aparece aqui após a primeira chamada" />}
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'agentes' && <AgentesIaPanel />}

      {tab === 'flags' && <FeatureFlagsPanel />}

      {tab === 'auditoria' && (
        <div className="bg-white border border-border rounded-card overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
            <div className="font-bold text-[14px]">Trilha de auditoria (hash chain)</div>
            {audit && (
              <span
                className="text-[11.5px] font-bold px-2.5 py-1 rounded-md"
                style={audit.chain.valid ? { background: '#EAF3EE', color: '#0A5C36' } : { background: '#F7E9E7', color: '#B3261E' }}
              >
                {audit.chain.valid ? 'Cadeia íntegra ✓' : `Violação detectada no evento #${audit.chain.brokenAt}`}
              </span>
            )}
          </div>
          {(audit?.entries ?? []).map((e) => (
            <div key={e.id} className="px-5 py-3 border-b border-[#F5F7FA] last:border-b-0 flex items-center justify-between gap-3 text-[13px]">
              <div>
                <b>{e.actor}</b> — {e.action}
                <span className="text-textMuted"> · {e.quando}</span>
              </div>
              <span className="font-mono-num text-[11px] text-textTertiary">#{e.hash}</span>
            </div>
          ))}
          {audit && audit.entries.length === 0 && <EmptyState title="Nenhum evento registrado ainda" hint="Ações sensíveis da plataforma vão aparecer aqui" />}
        </div>
      )}

      {tab === 'auditoria' && (
        <div className="bg-white border border-border rounded-card overflow-hidden mt-5">
          <div className="px-5 py-3.5 border-b border-border">
            <div className="font-bold text-[14px]">Depósitos via TED pendentes de confirmação</div>
            <div className="text-[12px] text-textMuted mt-0.5">Sem webhook automático (ver lib/tedRail.ts) — confira o extrato bancário real antes de confirmar</div>
          </div>
          {tedPendentes.map((t) => (
            <div key={t.referencia} className="px-5 py-3 border-b border-[#F5F7FA] last:border-b-0 flex items-center justify-between gap-3 text-[13px]">
              <div>
                <b>{t.empresa}</b> — {t.valorFmt}
                <span className="text-textMuted">
                  {' '}
                  · {t.banco} ag. {t.agencia} cc {t.conta} · ref. {t.referencia} · {t.quando}
                </span>
              </div>
              <Button size="sm" variant="success" disabled={confirmingTed === t.referencia} onClick={() => confirmarTed(t.referencia)}>
                {confirmingTed === t.referencia ? 'Confirmando…' : 'Confirmar recebimento'}
              </Button>
            </div>
          ))}
          {tedPendentes.length === 0 && <EmptyState title="Nenhum TED pendente" hint="Depósitos via TED aparecem aqui até serem confirmados" />}
        </div>
      )}

      {tab === 'auditoria' && (
        <div className="bg-white border border-border rounded-card overflow-hidden mt-5">
          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
            <div>
              <div className="font-bold text-[14px]">Backups do banco de dados</div>
              <div className="text-[12px] text-textMuted mt-0.5">Snapshots automáticos a cada 6h, retenção configurável (padrão: últimos 28)</div>
            </div>
            <Button onClick={runBackupNow} disabled={runningBackup || !backupsEnabled} variant="secondary">
              {runningBackup ? 'Gerando…' : 'Rodar backup agora'}
            </Button>
          </div>
          {!backupsEnabled && (
            <div className="px-5 py-3.5 text-[13px] text-textMuted">Desabilitado neste ambiente (banco em memória — não há arquivo em disco para copiar).</div>
          )}
          {backupsEnabled &&
            backups.map((b) => (
              <div key={b.filename} className="px-5 py-3 border-b border-[#F5F7FA] last:border-b-0 flex items-center justify-between gap-3 text-[13px]">
                <div className="font-mono-num text-[12px]">{b.filename}</div>
                <div className="flex items-center gap-3 text-textMuted">
                  <span>{(b.sizeBytes / (1024 * 1024)).toFixed(2)} MB</span>
                  <span>{b.quando}</span>
                </div>
              </div>
            ))}
          {backupsEnabled && backups.length === 0 && <EmptyState title="Nenhum backup gerado ainda" hint="O primeiro roda automaticamente ao iniciar o servidor" />}
        </div>
      )}

      {tab === 'auditoria' && (
        <div className="bg-white border border-border rounded-card overflow-hidden mt-5">
          <div className="px-5 py-3.5 border-b border-border">
            <div className="font-bold text-[14px]">Receita de add-ons</div>
            <div className="text-[12px] text-textMuted mt-0.5">Preços por produto e cobranças reais lançadas (lib/addOnBilling.ts)</div>
          </div>
          <div className="px-5 py-3.5 border-b border-[#F5F7FA]">
            <div className="text-[12px] font-bold text-textMuted uppercase mb-2">Franquia mensal da API (chamadas incluídas antes do excedente)</div>
            <div className="flex items-center gap-2">
              <input
                value={includedCallsInput}
                onChange={(e) => setIncludedCallsInput(e.target.value)}
                className="w-32 px-2.5 py-1.5 rounded-md border border-inputBorder font-mono-num text-[12.5px]"
              />
              <Button size="sm" variant="secondary" disabled={savingIncluded || includedCallsInput === String(includedCalls)} onClick={saveIncludedCalls}>
                {savingIncluded ? 'Salvando…' : 'Salvar'}
              </Button>
            </div>
          </div>
          {addonPrices.map((p) => {
            const summary = addonResumo.find((r) => r.kind === p.kind);
            return (
              <div key={p.kind} className="px-5 py-3 border-b border-[#F5F7FA] last:border-b-0 flex items-center justify-between gap-3 flex-wrap text-[13px]">
                <div className="min-w-[220px]">
                  <div className="font-semibold">{ADDON_KIND_LABELS[p.kind]}</div>
                  <div className="text-textMuted text-[11.5px] mt-0.5">
                    Padrão: {p.padraoFmt} · Total cobrado: {summary?.totalFmt ?? '—'} ({summary?.count ?? 0} cobrança{summary?.count === 1 ? '' : 's'})
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    value={addonPriceInputs[p.kind] ?? ''}
                    onChange={(e) => setAddonPriceInputs((prev) => ({ ...prev, [p.kind]: e.target.value }))}
                    className="w-24 px-2.5 py-1.5 rounded-md border border-inputBorder font-mono-num text-[12.5px]"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={savingAddonKind === p.kind || addonPriceInputs[p.kind] === String(p.preco)}
                    onClick={() => saveAddonPrice(p.kind)}
                  >
                    {savingAddonKind === p.kind ? 'Salvando…' : 'Salvar'}
                  </Button>
                </div>
              </div>
            );
          })}
          <div className="px-5 py-3.5 border-b border-[#F5F7FA] flex items-center gap-2 flex-wrap">
            <span className="text-[12px] text-textMuted mr-1">Rodar cobrança mensal agora (mês anterior completo):</span>
            <Button size="sm" variant="secondary" disabled={runningAddonJob === 'api-overage'} onClick={() => runAddonBillingJob('api-overage')}>
              {runningAddonJob === 'api-overage' ? 'Cobrando…' : 'Excedente de API'}
            </Button>
            <Button size="sm" variant="secondary" disabled={runningAddonJob === 'whitelabel-plus'} onClick={() => runAddonBillingJob('whitelabel-plus')}>
              {runningAddonJob === 'whitelabel-plus' ? 'Cobrando…' : 'White-label Plus'}
            </Button>
            <Button size="sm" variant="secondary" disabled={runningAddonJob === 'institutional-reporting'} onClick={() => runAddonBillingJob('institutional-reporting')}>
              {runningAddonJob === 'institutional-reporting' ? 'Cobrando…' : 'Relatórios Institucionais'}
            </Button>
          </div>
          <div className="px-5 py-3.5">
            <div className="font-bold text-[13px] mb-2">Cobranças recentes</div>
            <div className="flex flex-col gap-1.5">
              {addonRecentes.map((c) => (
                <div key={c.id} className="flex items-center justify-between text-[12.5px] gap-2">
                  <span className="text-textMuted flex-1 min-w-0 truncate">
                    <b className="text-textPrimary">{c.empresa}</b> — {c.descricao}
                  </span>
                  <span className="font-mono-num font-bold flex-shrink-0">{c.valorFmt}</span>
                  <span className="text-textTertiary flex-shrink-0">{c.quando}</span>
                </div>
              ))}
              {addonRecentes.length === 0 && <EmptyState title="Nenhuma cobrança de add-on ainda" hint="Cobranças aparecem aqui assim que geradas" />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
