import { useEffect, useRef, useState } from 'react';
import { api, ApiError, uploadFile } from '../../lib/api';
import { PageHeader, Card, NavyCard } from '../../components/ui/Card';
import { Field, Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Toggle } from '../../components/ui/Toggle';
import { ProgressBar } from '../../components/ui/ProgressBar';

interface EmitForm {
  sacado: string;
  cnpj: string;
  valor: string;
  vencimento: string;
  seguro: boolean;
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

function fmtBRL(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

const EMPTY_FORM: EmitForm = { sacado: '', cnpj: '', valor: '', vencimento: '', seguro: false };

export function EmitirPage() {
  const [form, setForm] = useState<EmitForm>(EMPTY_FORM);
  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);
  const [nfAnexada, setNfAnexada] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ registro: string; seguro: boolean; registradora: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
        <PageHeader title="Emitir Duplicata" subtitle="Emita e registre uma duplicata escritural diretamente na Lastro — sem sair da plataforma" />
        <Card className="p-10 text-center max-w-[560px]">
          <div className="w-14 h-14 rounded-full bg-greenBg mx-auto mb-4.5 flex items-center justify-center">
            <div className="w-6 h-6 rounded-full border-[3px] border-green" />
          </div>
          <div className="font-extrabold text-lg">Duplicata registrada com sucesso</div>
          <div className="text-textSecondary text-[13.5px] mt-2">
            Registro escritural nº {result.registro} confirmado na {result.registradora}. Status: enviada ao Marketplace.
          </div>
          <div className="flex justify-center gap-2.5 mt-5.5">
            <span className="text-[11.5px] font-bold px-2.5 py-1 rounded-md bg-greenBg text-green">Registrada — {result.registradora}</span>
            {result.seguro && <span className="text-[11.5px] font-bold px-2.5 py-1 rounded-md bg-chip text-blue">Protegida por seguro</span>}
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
        title="Emitir Duplicata"
        subtitle="Emita e registre uma duplicata escritural diretamente na Lastro — sem sair da plataforma"
        right={<span className="text-[11.5px] font-bold px-3 py-1.5 rounded-md bg-greenBg text-green">Aprovação em minutos · dinheiro em até 24h</span>}
      />

      <div className="grid gap-4 items-start" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
        <Card className="p-7 flex flex-col gap-4">
          <Field label="Empresa sacada">
            <Input placeholder="ex: Grupo Atlas Varejo" value={form.sacado} onChange={(e) => setField('sacado', e.target.value)} />
          </Field>
          <Field label="CNPJ do sacado">
            <Input placeholder="00.000.000/0001-00" value={form.cnpj} onChange={(e) => setField('cnpj', e.target.value)} />
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
          <button type="button" onClick={() => fileRef.current?.click()} className="border-2 border-dashed border-[#C7D0DE] rounded-xl p-5.5 text-center cursor-pointer bg-transparent">
            <div className="font-bold text-[13.5px]">{nfAnexada ? 'NF-e anexada ✓' : uploading ? 'Enviando…' : 'Anexar NF-e (XML, PDF ou imagem)'}</div>
            <div className="text-textSecondary text-[12.5px] mt-1">
              {nfAnexada ? 'Sacado, CNPJ, valor e vencimento extraídos automaticamente por IA' : 'Lastro fiscal necessário para registro escritural — clique para enviar o arquivo'}
            </div>
          </button>

          <div className="p-3.5 rounded-[10px] bg-[#F7F8FA]">
            <div className="flex items-center justify-between mb-2">
              <div className="font-bold text-[13px]">Duplicatas adicionais deste sacado</div>
              <button type="button" onClick={addBatchRow} className="bg-transparent border-none text-blue text-xs font-bold cursor-pointer">
                + Adicionar
              </button>
            </div>
            <div className="text-textSecondary text-xs mb-2.5">Emita várias notas do mesmo sacado de uma vez — economize tempo com emissão em lote</div>
            {batchRows.map((row) => (
              <div key={row.id} className="flex items-center gap-2 mb-2">
                <input
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

          <div className="flex items-center justify-between p-3.5 rounded-[10px] bg-[#F7F8FA]">
            <div>
              <div className="font-bold text-[13.5px]">Contratar seguro sobre o recebível</div>
              <div className="text-textSecondary text-xs mt-0.5">Protege o investidor contra inadimplência do sacado — prêmio de 0,6% do valor</div>
            </div>
            <Toggle on={form.seguro} onClick={() => setField('seguro', !form.seguro)} />
          </div>

          <Button disabled={submitting} onClick={submit} className="py-3.5">
            {submitting ? 'Registrando na registradora…' : 'Emitir e registrar duplicata escritural'}
          </Button>
          {error && <div className="px-3.5 py-3 rounded-lg bg-redBg text-red text-sm font-semibold">{error}</div>}
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <div className="flex items-center justify-between mb-1">
              <div className="font-bold text-[14.5px]">Checklist de lastro</div>
              <div className="text-[13px] font-extrabold" style={{ color: preview?.lastroChecklist.color }}>
                {preview?.lastroChecklist.pct ?? 0}%
              </div>
            </div>
            <div className="text-textSecondary text-xs mb-3.5">Quanto mais completo, menor o risco percebido pelo financiador — e melhor a taxa</div>
            <div className="mb-4">
              <ProgressBar pct={preview?.lastroChecklist.pct ?? 0} color={preview?.lastroChecklist.color ?? '#D6DCE5'} />
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

          <Card className="px-6 py-5">
            <div className="font-bold text-sm mb-1">Limite pré-aprovado</div>
            <div className="text-[22px] font-extrabold text-blue mb-1">{fmtBRL(preview?.preApprovedLimit ?? 40000)}</div>
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
                <div key={t.label} className="flex justify-between px-2 py-1.5 rounded-md" style={{ background: t.active ? '#EEF3FF' : 'transparent' }}>
                  <div>{t.label}</div>
                  <div className="font-bold font-mono-num">{t.rate}</div>
                </div>
              ))}
            </div>
          </Card>

          <NavyCard className="px-6.5 py-6.5">
            <div className="font-bold text-[14.5px] mb-4">Resumo do registro</div>
            <div className="flex flex-col gap-3 text-[13.5px]">
              <div className="flex justify-between">
                <span className="text-[#9FB3D6]">Valor da duplicata</span>
                <span className="font-bold font-mono-num">{preview?.emitSummary.valorFmt ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#9FB3D6]">Prêmio do seguro</span>
                <span className="font-bold font-mono-num">{preview?.emitSummary.premioFmt ?? '—'}</span>
              </div>
              <div className="h-px" style={{ background: 'rgba(255,255,255,0.14)' }} />
              <div className="flex justify-between">
                <span className="text-[#9FB3D6]">Registradoras</span>
                <span className="font-bold">CERC · B3 · Núclea</span>
              </div>
              <div className="h-px" style={{ background: 'rgba(255,255,255,0.14)' }} />
              <div className="flex justify-between">
                <span className="text-[#9FB3D6]">Taxa estimada (leilão)</span>
                <span className="font-bold font-mono-num text-[#4C8CFF]">{preview?.emitSummary.taxaEstimadaFmt ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#9FB3D6]">Sua taxa de plataforma</span>
                <span className="font-bold font-mono-num">{preview?.emitSummary.plataformaFeeFmt ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#9FB3D6]">Base legal</span>
                <span className="font-bold">Res. BCB 339/2023</span>
              </div>
            </div>
          </NavyCard>
        </div>
      </div>
    </div>
  );
}
