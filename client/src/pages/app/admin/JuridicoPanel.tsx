import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../lib/api';
import { Button } from '../../../components/ui/Button';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { PALETTE } from '../../../lib/palette';

interface LegalDocRef {
  id: number;
  type: string;
  content: string;
  reviewed: boolean;
  quando?: string;
  signatureStatus?: 'none' | 'enviado' | 'assinado';
  signerName?: string | null;
  signerEmail?: string | null;
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

type LegalSubTab = 'cobranca' | 'minutas' | 'regulatorio';

// As 3 frentes jurídicas do back-office, cada uma sua própria sub-tab: cobrança de
// duplicatas vencidas (documentos + fee de sucesso sobre recuperação), minutas geradas por
// IA (sempre rascunho — precisa de revisão humana, com envio real para assinatura
// eletrônica quando configurado) e monitor regulatório (análise de texto colado, não
// monitoramento automático).
export function JuridicoPanel() {
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
  const [signerNameById, setSignerNameById] = useState<Record<number, string>>({});
  const [signerEmailById, setSignerEmailById] = useState<Record<number, string>>({});
  const [signingId, setSigningId] = useState<number | null>(null);
  const [regulatoryNotes, setRegulatoryNotes] = useState<RegulatoryNote[]>([]);
  const [regTitle, setRegTitle] = useState('');
  const [regText, setRegText] = useState('');
  const [analyzingReg, setAnalyzingReg] = useState(false);
  const [regError, setRegError] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

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

  const loadAll = () => {
    setLoadError(null);
    Promise.all([loadCobrancaJuridica(), loadMinutas(), loadRegulatorio(), loadFeeConfig(), loadRecoveries()]).catch((err) =>
      setLoadError(err instanceof ApiError ? err.message : 'Falha ao carregar o painel jurídico.')
    );
  };

  useEffect(() => {
    loadAll();
  }, []);

  if (loadError) return <ErrorState message={loadError} onRetry={loadAll} />;

  const saveFeePct = async () => {
    const n = Number(feePctInput);
    if (!Number.isFinite(n) || n < 0 || n > 50) return;
    setSavingFeePct(true);
    try {
      await api.put('/admin/juridico/cobranca-fee', { feePct: n });
      await loadFeeConfig();
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
    } catch (err) {
      setCollectionError((prev) => ({ ...prev, [key]: err instanceof ApiError ? err.message : 'Não foi possível gerar o documento.' }));
    } finally {
      setGeneratingCollection(null);
    }
  };

  const reviewCollectionDoc = async (id: number) => {
    await api.post(`/admin/juridico/documentos/${id}/revisar`);
    await loadCobrancaJuridica();
  };

  const reviewMinuta = async (id: number) => {
    await api.post(`/admin/juridico/documentos/${id}/revisar`);
    await loadMinutas();
  };

  const sendMinutaForSignature = async (id: number) => {
    const signerName = (signerNameById[id] ?? '').trim();
    const signerEmail = (signerEmailById[id] ?? '').trim();
    if (!signerName || !signerEmail) return;
    setSigningId(id);
    try {
      await api.post(`/admin/juridico/documentos/${id}/assinatura`, { signerName, signerEmail });
      await loadMinutas();
      await loadCobrancaJuridica();
    } finally {
      setSigningId(null);
    }
  };

  const checkMinutaSignature = async (id: number) => {
    setSigningId(id);
    try {
      await api.post(`/admin/juridico/documentos/${id}/assinatura/status`);
      await loadMinutas();
      await loadCobrancaJuridica();
    } finally {
      setSigningId(null);
    }
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
    } catch (err) {
      setRegError(err instanceof ApiError ? err.message : 'Não foi possível analisar o texto.');
    } finally {
      setAnalyzingReg(false);
    }
  };

  const acknowledgeRegulatory = async (id: number) => {
    await api.post(`/admin/juridico/regulatorio/${id}/reconhecer`);
    await loadRegulatorio();
  };

  return (
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
            style={{ background: legalSubTab === key ? '#fff' : 'transparent', color: legalSubTab === key ? PALETTE.navy : PALETTE.textSecondary }}
          >
            {label}
          </button>
        ))}
      </div>

      {legalSubTab === 'cobranca' && (
        <div className="flex flex-col gap-4">
          <div className="rounded-[10px] px-4 py-3 text-[12.5px]" style={{ background: PALETTE.amberBg, color: PALETTE.amber }}>
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
                  <div className="font-bold text-[15px] mt-1">
                    {o.cedente} → {o.sacado} — {o.valorFmt}
                  </div>
                  <div className="text-textSecondary text-[12.5px] mt-1">
                    Vencimento {o.vencimento} · {o.diasEmAtraso} dia(s) em atraso
                  </div>
                </div>
                {o.eligible ? (
                  <span className="text-[11.5px] font-bold px-3 py-1.5 rounded-md" style={{ background: PALETTE.redBg, color: PALETTE.red }}>
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
                  <div key={k} className="text-red text-[12.5px] font-semibold mb-2">
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
                          className="text-[11.5px] font-bold px-2 py-0.5 rounded-md ml-2"
                          style={doc.reviewed ? { background: PALETTE.greenBg, color: PALETTE.green } : { background: PALETTE.amberBg, color: PALETTE.amber }}
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
                  {recoveryError[o.duplicataId] && <div className="text-red text-[12.5px] font-semibold mt-1.5">{recoveryError[o.duplicataId]}</div>}
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
              <div key={r.duplicataId} className="px-5 py-3 border-b border-bg last:border-b-0 flex items-center justify-between gap-3 text-[13px]">
                <div>
                  <div className="font-mono-num font-bold text-textSecondary">{r.duplicataId}</div>
                  <div className="text-textSecondary text-[12.5px]">
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
          <div className="rounded-[10px] px-4 py-3 text-[12.5px]" style={{ background: PALETTE.amberBg, color: PALETTE.amber }}>
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
            {minutaError && <div className="text-red text-[12.5px] font-semibold">{minutaError}</div>}
          </form>

          {minutas.map((doc) => (
            <details key={doc.id} className="bg-white border border-border rounded-card px-5 py-4">
              <summary className="cursor-pointer text-[13px] font-bold flex items-center justify-between">
                <span>
                  {MINUTA_TYPE_LABELS[doc.type] ?? doc.type} · {doc.quando}
                </span>
                <span
                  className="text-[11.5px] font-bold px-2 py-0.5 rounded-md ml-2"
                  style={doc.reviewed ? { background: PALETTE.greenBg, color: PALETTE.green } : { background: PALETTE.amberBg, color: PALETTE.amber }}
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
              {doc.reviewed && (!doc.signatureStatus || doc.signatureStatus === 'none') && (
                <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                  <input
                    placeholder="Nome do signatário"
                    value={signerNameById[doc.id] ?? ''}
                    onChange={(e) => setSignerNameById((prev) => ({ ...prev, [doc.id]: e.target.value }))}
                    className="px-2.5 py-1.5 rounded-md border border-inputBorder text-[12.5px] w-44"
                  />
                  <input
                    placeholder="Email do signatário"
                    value={signerEmailById[doc.id] ?? ''}
                    onChange={(e) => setSignerEmailById((prev) => ({ ...prev, [doc.id]: e.target.value }))}
                    className="px-2.5 py-1.5 rounded-md border border-inputBorder text-[12.5px] w-56"
                  />
                  <Button
                    size="sm"
                    disabled={signingId === doc.id || !(signerNameById[doc.id] ?? '').trim() || !(signerEmailById[doc.id] ?? '').trim()}
                    onClick={() => sendMinutaForSignature(doc.id)}
                  >
                    {signingId === doc.id ? 'Enviando…' : 'Enviar para assinatura eletrônica'}
                  </Button>
                </div>
              )}
              {doc.signatureStatus === 'enviado' && (
                <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                  <span className="text-[11.5px] font-bold px-2 py-0.5 rounded-md bg-amberBg text-amber">
                    Aguardando assinatura de {doc.signerName} ({doc.signerEmail})
                  </span>
                  <Button size="sm" variant="secondary" disabled={signingId === doc.id} onClick={() => checkMinutaSignature(doc.id)}>
                    {signingId === doc.id ? 'Verificando…' : 'Verificar status'}
                  </Button>
                </div>
              )}
              {doc.signatureStatus === 'assinado' && (
                <span className="mt-2.5 inline-block text-[11.5px] font-bold px-2 py-0.5 rounded-md bg-greenBg text-green">
                  Assinado por {doc.signerName}
                </span>
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
            {regError && <div className="text-red text-[12.5px] font-semibold">{regError}</div>}
          </form>

          {regulatoryNotes.map((n) => (
            <div key={n.id} className="bg-white border border-border rounded-card p-5">
              <div className="flex items-center justify-between mb-2">
                <div className="font-bold text-[14px]">{n.title}</div>
                <span
                  className="text-[11.5px] font-bold px-2.5 py-1 rounded-md"
                  style={n.acknowledged ? { background: PALETTE.greenBg, color: PALETTE.green } : { background: PALETTE.amberBg, color: PALETTE.amber }}
                >
                  {n.acknowledged ? 'Reconhecido' : 'Pendente'}
                </span>
              </div>
              <div className="text-textSecondary text-[12.5px] mb-2">{n.summary}</div>
              {n.impactAreas.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {n.impactAreas.map((a, i) => (
                    <span key={i} className="text-[11.5px] font-bold px-2 py-1 rounded-md bg-chip text-blue">
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
  );
}
