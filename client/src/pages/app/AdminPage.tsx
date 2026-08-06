import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { PageHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';

interface PendingKyb {
  id: number;
  nome: string;
  email: string;
  companyName: string;
  kybForm: { cnpj?: string; tipo?: string; pl?: string };
  submittedAt: string;
  pldStatus: 'clear' | 'flagged';
  pldMatchNote: string;
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
  valorFmt: string;
  vencimento: string;
  eligible: boolean;
  reason: string | null;
  diasEmAtraso: number;
  documentos: LegalDocRef[];
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

type Tab = 'kyb' | 'disputas' | 'compliance' | 'juridico' | 'ia' | 'auditoria';
type LegalSubTab = 'cobranca' | 'minutas' | 'regulatorio';

export function AdminPage() {
  const [tab, setTab] = useState<Tab>('kyb');
  const [pending, setPending] = useState<PendingKyb[]>([]);
  const [disputes, setDisputes] = useState<AdminDispute[]>([]);
  const [audit, setAudit] = useState<{ entries: AuditEntry[]; chain: { valid: boolean; brokenAt: number | null } } | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [noteById, setNoteById] = useState<Record<number, string>>({});
  const [aiSummaryById, setAiSummaryById] = useState<Record<number, { recommendation: string; reasoning: string } | null>>({});
  const [loadingAiId, setLoadingAiId] = useState<number | null>(null);
  const [complianceQueue, setComplianceQueue] = useState<ComplianceQueueItem[]>([]);
  const [complianceNoteById, setComplianceNoteById] = useState<Record<string, string>>({});
  const [aiUsage, setAiUsage] = useState<AiUsageSummary | null>(null);
  const [threshold, setThreshold] = useState<{ threshold: number; default: number } | null>(null);
  const [thresholdInput, setThresholdInput] = useState('');
  const [savingThreshold, setSavingThreshold] = useState(false);

  const [legalSubTab, setLegalSubTab] = useState<LegalSubTab>('cobranca');
  const [overdue, setOverdue] = useState<OverdueCollectionItem[]>([]);
  const [legalDisclaimer, setLegalDisclaimer] = useState('');
  const [generatingCollection, setGeneratingCollection] = useState<string | null>(null);
  const [collectionError, setCollectionError] = useState<Record<string, string>>({});
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

  const loadKyb = () => api.get<{ pending: PendingKyb[] }>('/admin/kyb').then((d) => setPending(d.pending));
  const loadDisputes = () => api.get<{ disputes: AdminDispute[] }>('/admin/disputes').then((d) => setDisputes(d.disputes));
  const loadAudit = () => api.get<{ entries: AuditEntry[]; chain: { valid: boolean; brokenAt: number | null } }>('/admin/audit').then(setAudit);
  const loadCompliance = () => api.get<{ pending: ComplianceQueueItem[] }>('/admin/compliance-queue').then((d) => setComplianceQueue(d.pending));
  const loadAiUsage = () => api.get<AiUsageSummary>('/admin/ai-usage').then(setAiUsage);
  const loadThreshold = () =>
    api.get<{ threshold: number; default: number }>('/admin/compliance-threshold').then((d) => {
      setThreshold(d);
      setThresholdInput(String(d.threshold));
    });
  const loadCobrancaJuridica = () =>
    api.get<{ overdue: OverdueCollectionItem[]; disclaimer: string }>('/admin/juridico/cobranca').then((d) => {
      setOverdue(d.overdue);
      setLegalDisclaimer(d.disclaimer);
    });
  const loadMinutas = () => api.get<{ documentos: LegalDocRef[] }>('/admin/juridico/minutas').then((d) => setMinutas(d.documentos));
  const loadRegulatorio = () => api.get<{ notes: RegulatoryNote[] }>('/admin/juridico/regulatorio').then((d) => setRegulatoryNotes(d.notes));

  useEffect(() => {
    loadKyb();
    loadDisputes();
    loadAudit();
    loadCompliance();
    loadAiUsage();
    loadThreshold();
    loadCobrancaJuridica();
    loadMinutas();
    loadRegulatorio();
  }, []);

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
                <span className="text-[11.5px] font-bold px-3 py-1.5 rounded-md bg-amberBg text-amber">Aguardando análise — {p.submittedAt}</span>
              </div>
              {p.pldStatus === 'flagged' && (
                <div className="rounded-[10px] px-4 py-3 mb-3 text-[12.5px]" style={{ background: '#F7E9E7', color: '#B3261E' }}>
                  <b>PLD/FT — possível correspondência (lista de demonstração)</b>
                  <div className="mt-0.5">{p.pldMatchNote}</div>
                </div>
              )}
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
                </div>
              ))}
              {overdue.length === 0 && (
                <div className="bg-white border border-border rounded-card">
                  <EmptyState title="Nenhuma duplicata vencida no momento" hint="Duplicatas vencidas elegíveis para cobrança jurídica aparecem aqui" />
                </div>
              )}
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
    </div>
  );
}
