import { useEffect, useRef, useState } from 'react';
import { api, ApiError, uploadFile } from '../../lib/api';
import { PageHeader, Card, NavyCard } from '../../components/ui/Card';
import { Field, Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Toggle } from '../../components/ui/Toggle';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { SelfServiceAgentCard } from '../../components/agents/SelfServiceAgentCard';
import { useLang } from '../../lib/i18n';
import { PALETTE } from '../../lib/palette';
import { Badge } from '../../components/ui/Badge';
import { Notice } from '../../components/ui/Notice';

interface EmitForm {
  sacado: string;
  cnpj: string;
  valor: string;
  vencimento: string;
  seguro: boolean;
  nfeChave: string;
}
interface BatchRow {
  id: string;
  valor: string;
}
interface ChecklistItem {
  label: string;
  done: boolean;
  color: string;
  textColor: string;
}
interface Preview {
  lastroChecklist: { items: ChecklistItem[]; pct: number; color: string };
  preApprovedLimit: number;
  emitSummary: { valorFmt: string; premioFmt: string; taxaEstimadaFmt: string; plataformaFeeFmt: string; totalValor: number };
  sacadoRecognized: boolean;
  sacadoRecognizedText: string;
}
interface LoteRowResult {
  index: number;
  sacado: string;
  ok: boolean;
  duplicataId?: string;
  registro?: string;
  error?: string;
}
interface LoteOutcome {
  total: number;
  sucesso: number;
  falhas: number;
  resultados: LoteRowResult[];
}
interface MinhaMatricula {
  sacadoNome: string;
  taxaAmFmt: string;
  sublimiteFmt: string | null;
  programaAtivo: boolean;
}

const CSV_TEMPLATE = 'sacado,cnpj,valor,vencimento,seguro\nGrupo Atlas Varejo,58.442.111/0001-27,50000,2026-12-31,0\n';

// A CSV upload creating several separate duplicatas in one go, for cedentes with real
// volume — distinct from the "Duplicatas adicionais deste sacado" rows above (which
// consolidate several NF values into one single duplicata's total). Parsed entirely
// client-side (no file leaves the browser as a raw upload — just the parsed rows as JSON,
// same shape /emitir/submit already accepts) and posted to /emitir/lote, which emits each
// row through the exact same submitEmitir() path as a manual single emission.
function parseCsv(text: string): Record<string, string>[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = line.split(',').map((c) => c.trim());
    const row: Record<string, string> = {};
    header.forEach((h, i) => {
      row[h] = cells[i] ?? '';
    });
    return row;
  });
}

function LoteEmissaoCard() {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState<LoteOutcome | null>(null);
  const loteFileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setError('');
    setOutcome(null);
    setFileName(file.name);
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.length === 0) {
      setError('Nenhuma linha reconhecida no arquivo. Use o modelo (cabeçalho: sacado,cnpj,valor,vencimento,seguro).');
      setRows([]);
      return;
    }
    setRows(parsed);
  };

  const enviarLote = async () => {
    setError('');
    setBusy(true);
    try {
      const payload = rows.map((r) => ({
        sacado: r.sacado ?? '',
        cnpj: r.cnpj ?? '',
        valor: r.valor ?? '',
        vencimento: r.vencimento ?? '',
        seguro: r.seguro === '1' || r.seguro?.toLowerCase() === 'true',
      }));
      const data = await api.post<LoteOutcome>('/emitir/lote', { rows: payload });
      setOutcome(data);
      if (data.falhas === 0) {
        setRows([]);
        setFileName('');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível processar o lote.');
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'modelo-emissao-lote.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="mt-4">
      <div className="flex items-center justify-between mb-1">
        <div className="font-bold text-[15px]">Emissão em lote (CSV)</div>
        <button type="button" onClick={downloadTemplate} className="bg-transparent border-none text-blue text-xs font-bold cursor-pointer">
          Baixar modelo CSV
        </button>
      </div>
      <p className="text-[12.5px] text-textSecondary mb-3">
        Para cedentes de alto volume — emite várias duplicatas separadas de uma vez (até 200 linhas), cada uma pelo mesmo caminho real de uma
        emissão manual (mesmos limites, compliance, registradora e webhook). Colunas: <code>sacado,cnpj,valor,vencimento,seguro</code>.
      </p>
      <input
        ref={loteFileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      <button
        type="button"
        onClick={() => loteFileRef.current?.click()}
        className="w-full border-2 border-dashed border-borderStrong rounded-xl p-4 text-center cursor-pointer bg-transparent mb-3"
      >
        <div className="font-bold text-[13px]">{fileName ? `${fileName} — ${rows.length} linha(s) reconhecida(s)` : 'Selecionar arquivo CSV'}</div>
      </button>
      {rows.length > 0 && (
        <Button disabled={busy} onClick={enviarLote} className="mb-3">
          {busy ? 'Emitindo lote…' : `Emitir ${rows.length} duplicata(s)`}
        </Button>
      )}
      {error && <Notice variant="danger" className="text-sm mb-3">{error}</Notice>}
      {outcome && (
        <div>
          <div className="text-[12.5px] font-bold mb-2">
            {outcome.sucesso} de {outcome.total} emitida(s) com sucesso{outcome.falhas > 0 ? ` — ${outcome.falhas} falha(s)` : ''}
          </div>
          <div className="flex flex-col gap-1.5">
            {outcome.resultados.map((r) => (
              <div key={r.index} className="flex items-center justify-between text-[12.5px] px-2.5 py-1.5 rounded-md" style={{ background: r.ok ? PALETTE.greenBg : PALETTE.redBg }}>
                <span className="font-semibold">{r.sacado || `linha ${r.index + 1}`}</span>
                <span style={{ color: r.ok ? PALETTE.green : PALETTE.red }}>{r.ok ? `Registrada — ${r.registro}` : r.error}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function fmtBRL(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

const EMPTY_FORM: EmitForm = { sacado: '', cnpj: '', valor: '', vencimento: '', seguro: false, nfeChave: '' };

export function EmitirPage() {
  const { t } = useLang();
  const [form, setForm] = useState<EmitForm>(EMPTY_FORM);
  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);
  const [nfAnexada, setNfAnexada] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ registro: string; seguro: boolean; registradora: string } | null>(null);
  const [matriculas, setMatriculas] = useState<MinhaMatricula[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .get<{ matriculas: MinhaMatricula[] }>('/confirming/minhas-matriculas')
      .then((d) => setMatriculas(d.matriculas))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      api
        .post<Preview>('/emitir/preview', { ...form, nfAnexada, batchValores: batchRows.map((r) => r.valor) })
        .then(setPreview)
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [form, nfAnexada, batchRows]);

  const setField = (field: keyof EmitForm, value: string | boolean) => setForm((f) => ({ ...f, [field]: value }));

  const handleNfFile = async (file: File) => {
    setUploading(true);
    try {
      const { extracted } = await uploadFile('nfe', file);
      setNfAnexada(true);
      if (extracted) {
        setForm((f) => ({
          sacado: f.sacado || extracted.sacado,
          cnpj: f.cnpj || extracted.cnpj,
          valor: f.valor || extracted.valor,
          vencimento: f.vencimento || extracted.vencimento,
          seguro: f.seguro,
          nfeChave: f.nfeChave,
        }));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao enviar o arquivo.');
    } finally {
      setUploading(false);
    }
  };

  const addBatchRow = () => setBatchRows((rows) => [...rows, { id: 'b' + Math.random().toString(16).slice(2, 8), valor: '' }]);
  const updateBatchRow = (id: string, valor: string) => setBatchRows((rows) => rows.map((r) => (r.id === id ? { ...r, valor } : r)));
  const removeBatchRow = (id: string) => setBatchRows((rows) => rows.filter((r) => r.id !== id));

  const submit = async () => {
    setError(null);
    if (!form.sacado.trim() || !form.valor.trim() || !form.vencimento) {
      setError('Preencha empresa sacada, valor e vencimento antes de enviar.');
      return;
    }
    setSubmitting(true);
    try {
      const data = await api.post<{ registro: string; seguro: boolean; registradora: string }>('/emitir/submit', {
        ...form,
        nfAnexada,
        batchValores: batchRows.map((r) => r.valor),
      });
      setResult(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao registrar — conexão instável. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setResult(null);
    setForm(EMPTY_FORM);
    setBatchRows([]);
    setNfAnexada(false);
  };

  if (result) {
    return (
      <div>
        <PageHeader title={t('emitir.title', 'Emitir Duplicata')} subtitle={t('emitir.subtitle', 'Emita e registre uma duplicata escritural diretamente na Lastro — sem sair da plataforma')} />
        <Card className="p-10 text-center max-w-[560px]">
          <div className="w-14 h-14 rounded-full bg-greenBg mx-auto mb-4.5 flex items-center justify-center">
            <div className="w-6 h-6 rounded-full border-[3px] border-green" />
          </div>
          <div className="font-extrabold text-lg">Duplicata registrada com sucesso</div>
          <div className="text-textSecondary text-[13px] mt-2">
            {`Registro escritural nº ${result.registro} confirmado na ${result.registradora}. Status: enviada ao Marketplace.`}
          </div>
          <div className="flex justify-center gap-2.5 mt-5.5">
            <Badge variant="success">Registrada — {result.registradora}</Badge>
            {result.seguro && <Badge variant="info">Protegida por seguro</Badge>}
          </div>
          <Button className="mt-6" onClick={reset}>
            Emitir outra duplicata
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t('emitir.title', 'Emitir Duplicata')}
        subtitle={t('emitir.subtitle', 'Emita e registre uma duplicata escritural diretamente na Lastro — sem sair da plataforma')}
        right={<Badge variant="success" size="lg">Aprovação em minutos · dinheiro em até 24h</Badge>}
      />

      <div className="mb-4">
        <SelfServiceAgentCard
          agentId="emissao"
          title="Deixe a IA investigar e emitir para você"
          placeholder="Ex: emita uma duplicata de R$ 50.000 para o Grupo Atlas Varejo (CNPJ 58.442.111/0001-27), vencimento em 30 dias, com seguro"
        />
      </div>

      <div className="grid gap-4 items-start" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
        <Card className="p-7 flex flex-col gap-4">
          <Field label="Empresa sacada">
            <Input placeholder="ex: Grupo Atlas Varejo" value={form.sacado} onChange={(e) => setField('sacado', e.target.value)} />
          </Field>
          <Field label="CNPJ do sacado">
            <Input placeholder="00.000.000/0001-00" value={form.cnpj} onChange={(e) => setField('cnpj', e.target.value)} />
          </Field>
          <Field label="Chave de acesso da NF-e (opcional — 44 dígitos)">
            <Input placeholder="Previne duplicidade: a mesma nota não pode lastrear duas duplicatas" value={form.nfeChave} onChange={(e) => setField('nfeChave', e.target.value)} />
          </Field>
          <div className="grid gap-3.5" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Field label="Valor (R$)">
              <Input placeholder="50.000" value={form.valor} onChange={(e) => setField('valor', e.target.value)} />
            </Field>
            <Field label="Vencimento">
              <Input type="date" value={form.vencimento} onChange={(e) => setField('vencimento', e.target.value)} />
            </Field>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept=".xml,.pdf,.png,.jpg,.jpeg"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleNfFile(f);
            }}
          />
          <button type="button" onClick={() => fileRef.current?.click()} className="border-2 border-dashed border-borderStrong rounded-xl p-5.5 text-center cursor-pointer bg-transparent">
            <div className="font-bold text-[13px]">{nfAnexada ? 'NF-e anexada ✓' : uploading ? 'Enviando…' : 'Anexar NF-e (XML, PDF ou imagem)'}</div>
            <div className="text-textSecondary text-[12.5px] mt-1">
              {nfAnexada ? 'Sacado, CNPJ, valor e vencimento extraídos automaticamente por IA' : 'Lastro fiscal necessário para registro escritural — clique para enviar o arquivo'}
            </div>
          </button>

          <div className="p-3.5 rounded-[10px] bg-surface">
            <div className="flex items-center justify-between mb-2">
              <div className="font-bold text-[13px]">Duplicatas adicionais deste sacado</div>
              <button type="button" onClick={addBatchRow} className="bg-transparent border-none text-blue text-xs font-bold cursor-pointer">
                + Adicionar
              </button>
            </div>
            <div className="text-textSecondary text-xs mb-2.5">Emita várias notas do mesmo sacado de uma vez — economize tempo com emissão em lote</div>
            {batchRows.map((row) => (
              <div key={row.id} className="flex items-center gap-2 mb-2">
                <input aria-label="Valor (R$)"
                  placeholder="Valor (R$)"
                  value={row.valor}
                  onChange={(e) => updateBatchRow(row.id, e.target.value)}
                  className="flex-1 px-3 py-2 rounded-md border border-inputBorder text-[13px] outline-none"
                />
                <button type="button" onClick={() => removeBatchRow(row.id)} className="bg-transparent border-none text-red text-xs font-bold cursor-pointer">
                  Remover
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between p-3.5 rounded-[10px] bg-surface">
            <div>
              <div className="font-bold text-[13px]">Contratar seguro sobre o recebível</div>
              <div className="text-textSecondary text-xs mt-0.5">Protege o investidor contra inadimplência do sacado — prêmio de 0,6% do valor</div>
            </div>
            <Toggle on={form.seguro} onClick={() => setField('seguro', !form.seguro)} />
          </div>

          <Button disabled={submitting} onClick={submit} className="py-3.5">
            {submitting ? 'Registrando na registradora…' : 'Emitir e registrar duplicata escritural'}
          </Button>
          {error && <Notice variant="danger" className="text-sm">{error}</Notice>}
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <div className="flex items-center justify-between mb-1">
              <div className="font-bold text-[14px]">Checklist de lastro</div>
              <div className="text-[13px] font-extrabold" style={{ color: preview?.lastroChecklist.color }}>
                {preview?.lastroChecklist.pct ?? 0}%
              </div>
            </div>
            <div className="text-textSecondary text-xs mb-3.5">Quanto mais completo, menor o risco percebido pelo financiador — e melhor a taxa</div>
            <div className="mb-4">
              <ProgressBar pct={preview?.lastroChecklist.pct ?? 0} color={preview?.lastroChecklist.color ?? PALETTE.inputBorder} />
            </div>
            <div className="flex flex-col gap-2.5">
              {(preview?.lastroChecklist.items ?? []).map((item) => (
                <div key={item.label} className="flex items-center gap-2.5">
                  <span className="rounded flex-shrink-0" style={{ width: 16, height: 16, border: `1.5px solid ${item.color}`, background: item.done ? item.color : 'transparent' }} />
                  <span className="text-[13px]" style={{ color: item.textColor }}>
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          {preview?.sacadoRecognized && (
            <div className="flex items-center gap-2.5 p-3.5 rounded-[10px] bg-greenBg">
              <span className="rounded-full bg-green flex-shrink-0" style={{ width: 9, height: 9 }} />
              <span className="text-[12.5px] text-green font-semibold">{preview.sacadoRecognizedText}</span>
            </div>
          )}

          {matriculas.length > 0 && (
            <Card>
              <div className="font-bold text-sm mb-1">Meus Programas Confirming</div>
              <div className="text-textSecondary text-xs mb-3">Sacados que já pré-aprovaram você — financiamento futuro sem passar pelo leilão</div>
              <div className="flex flex-col gap-2">
                {matriculas.map((m) => (
                  <div key={m.sacadoNome} className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface">
                    <div>
                      <div className="font-semibold text-[12.5px]">{m.sacadoNome}</div>
                      {!m.programaAtivo && <div className="text-textSecondary text-[11.5px]">Programa pausado no momento</div>}
                    </div>
                    <div className="font-bold font-mono-num text-[12.5px]">{m.taxaAmFmt}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card className="px-6 py-5">
            <div className="font-bold text-sm mb-1">Limite pré-aprovado</div>
            <div className="text-[20px] font-extrabold text-blue mb-1">{fmtBRL(preview?.preApprovedLimit ?? 40000)}</div>
            <div className="text-textSecondary text-xs leading-snug">Com base no seu Checklist de Lastro atual e histórico de sacados já usados na plataforma</div>
          </Card>

          <Card className="px-6 py-5">
            <div className="font-bold text-sm mb-2.5">Desconto por volume mensal</div>
            <div className="flex flex-col gap-2 text-[12.5px]">
              {[
                { label: 'Até R$ 200 mil', rate: '0,35%', active: !!preview && preview.emitSummary.totalValor > 0 && preview.emitSummary.totalValor <= 200000 },
                { label: 'R$ 200 mil – R$ 1 milhão', rate: '0,30%', active: !!preview && preview.emitSummary.totalValor > 200000 && preview.emitSummary.totalValor <= 1000000 },
                { label: 'Acima de R$ 1 milhão', rate: '0,25%', active: !!preview && preview.emitSummary.totalValor > 1000000 },
              ].map((t) => (
                <div key={t.label} className="flex justify-between px-2 py-1.5 rounded-md" style={{ background: t.active ? PALETTE.chip : 'transparent' }}>
                  <div>{t.label}</div>
                  <div className="font-bold font-mono-num">{t.rate}</div>
                </div>
              ))}
            </div>
          </Card>

          <NavyCard className="px-6.5 py-6.5">
            <div className="font-bold text-[14px] mb-4">Resumo do registro</div>
            <div className="flex flex-col gap-3 text-[13px]">
              <div className="flex justify-between">
                <span className="text-onNavy">Valor da duplicata</span>
                <span className="font-bold font-mono-num">{preview?.emitSummary.valorFmt ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-onNavy">Prêmio do seguro</span>
                <span className="font-bold font-mono-num">{preview?.emitSummary.premioFmt ?? '—'}</span>
              </div>
              <div className="h-px" style={{ background: 'rgba(255,255,255,0.14)' }} />
              <div className="flex justify-between">
                <span className="text-onNavy">Registradoras</span>
                <span className="font-bold">CERC · B3 · Núclea</span>
              </div>
              <div className="h-px" style={{ background: 'rgba(255,255,255,0.14)' }} />
              <div className="flex justify-between">
                <span className="text-onNavy">Taxa estimada (leilão)</span>
                <span className="font-bold font-mono-num text-onNavyBright">{preview?.emitSummary.taxaEstimadaFmt ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-onNavy">Sua taxa de plataforma</span>
                <span className="font-bold font-mono-num">{preview?.emitSummary.plataformaFeeFmt ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-onNavy">Base legal</span>
                <span className="font-bold">Res. BCB 339/2023</span>
              </div>
            </div>
          </NavyCard>
        </div>
      </div>

      <LoteEmissaoCard />
    </div>
  );
}
