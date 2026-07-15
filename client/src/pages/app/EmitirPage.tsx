import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
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
interface EmitData {
  emitForm: EmitForm;
  batchRows: BatchRow[];
  nfAnexada: boolean;
  emitSubmitted: boolean;
  emitLoading: boolean;
  emitError: string | null;
  lastRegistro: string | null;
  lastroChecklist: { items: ChecklistItem[]; pct: number; color: string };
  preApprovedLimit: number;
  emitSummary: { valorFmt: string; premioFmt: string; taxaEstimadaFmt: string; plataformaFeeFmt: string; emitTotalValor: number };
}

function fmtBRL(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

export function EmitirPage() {
  const [data, setData] = useState<EmitData | null>(null);

  const load = () => api.get<EmitData>('/emitir').then(setData);

  useEffect(() => {
    load();
  }, []);

  if (!data) return null;

  const setField = async (field: keyof EmitForm, value: string | boolean) => {
    const d = await api.post<EmitData>('/emitir/field', { field, value });
    setData(d);
  };

  const toggleNf = () => api.post<EmitData>('/emitir/nf').then(setData);
  const toggleSeguro = () => api.post<EmitData>('/emitir/seguro').then(setData);
  const addBatch = () => api.post<EmitData>('/emitir/batch').then(setData);
  const updateBatch = (id: string, valor: string) => api.post<EmitData>(`/emitir/batch/${id}`, { valor }).then(setData);
  const removeBatch = (id: string) => api.del<EmitData>(`/emitir/batch/${id}`).then(setData);
  const submit = () => api.post<EmitData>('/emitir/submit').then(setData);
  const reset = () => api.post<EmitData>('/emitir/reset').then(setData);

  if (data.emitSubmitted) {
    return (
      <div>
        <PageHeader title="Emitir Duplicata" subtitle="Emita e registre uma duplicata escritural diretamente na Lastro — sem sair da plataforma" />
        <Card className="p-10 text-center max-w-[560px]">
          <div className="w-14 h-14 rounded-full bg-greenBg mx-auto mb-4.5 flex items-center justify-center">
            <div className="w-6 h-6 rounded-full border-[3px] border-green" />
          </div>
          <div className="font-extrabold text-lg">Duplicata registrada com sucesso</div>
          <div className="text-textSecondary text-[13.5px] mt-2">
            Registro escritural nº {data.lastRegistro} confirmado na CERC. Status: enviada ao Marketplace.
          </div>
          <div className="flex justify-center gap-2.5 mt-5.5">
            <span className="text-[11.5px] font-bold px-2.5 py-1 rounded-md bg-greenBg text-green">Registrada — CERC</span>
            {data.emitForm.seguro && <span className="text-[11.5px] font-bold px-2.5 py-1 rounded-md bg-chip text-blue">Protegida por seguro</span>}
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
            <Input placeholder="ex: Grupo Atlas Varejo" value={data.emitForm.sacado} onChange={(e) => setField('sacado', e.target.value)} />
          </Field>
          <Field label="CNPJ do sacado">
            <Input placeholder="00.000.000/0001-00" value={data.emitForm.cnpj} onChange={(e) => setField('cnpj', e.target.value)} />
          </Field>
          <div className="grid gap-3.5" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Field label="Valor (R$)">
              <Input placeholder="50.000" value={data.emitForm.valor} onChange={(e) => setField('valor', e.target.value)} />
            </Field>
            <Field label="Vencimento">
              <Input type="date" value={data.emitForm.vencimento} onChange={(e) => setField('vencimento', e.target.value)} />
            </Field>
          </div>

          <button type="button" onClick={toggleNf} className="border-2 border-dashed border-[#C7D0DE] rounded-xl p-5.5 text-center cursor-pointer bg-transparent">
            <div className="font-bold text-[13.5px]">{data.nfAnexada ? 'NF-e anexada ✓' : 'Anexar NF-e (XML)'}</div>
            <div className="text-textSecondary text-[12.5px] mt-1">
              {data.nfAnexada ? 'Sacado, CNPJ, valor e vencimento extraídos automaticamente por IA' : 'Lastro fiscal necessário para registro escritural — clique para simular anexo'}
            </div>
          </button>

          <div className="p-4 rounded-[10px] bg-chip" style={{ border: '1px solid #C9DAFF' }}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="font-bold text-[13.5px]">Conecte seu ERP e pare de preencher formulário</div>
                <div className="text-textSecondary text-xs mt-0.5">Omie, Bling, TOTVS ou SAP — a Lastro importa e emite suas notas automaticamente</div>
              </div>
              <Button size="sm" onClick={toggleNf}>
                Conectar ERP
              </Button>
            </div>
          </div>

          <div className="p-3.5 rounded-[10px] bg-[#F7F8FA]">
            <div className="flex items-center justify-between mb-2">
              <div className="font-bold text-[13px]">Duplicatas adicionais deste sacado</div>
              <button type="button" onClick={addBatch} className="bg-transparent border-none text-blue text-xs font-bold cursor-pointer">
                + Adicionar
              </button>
            </div>
            <div className="text-textSecondary text-xs mb-2.5">Emita várias notas do mesmo sacado de uma vez — economize tempo com emissão em lote</div>
            {data.batchRows.map((row) => (
              <div key={row.id} className="flex items-center gap-2 mb-2">
                <input
                  placeholder="Valor (R$)"
                  value={row.valor}
                  onChange={(e) => updateBatch(row.id, e.target.value)}
                  className="flex-1 px-3 py-2 rounded-md border border-inputBorder text-[13px] outline-none"
                />
                <button type="button" onClick={() => removeBatch(row.id)} className="bg-transparent border-none text-red text-xs font-bold cursor-pointer">
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
            <Toggle on={data.emitForm.seguro} onClick={toggleSeguro} />
          </div>

          <Button disabled={data.emitLoading} onClick={submit} className="py-3.5">
            {data.emitLoading ? 'Registrando na CERC…' : 'Emitir e registrar duplicata escritural'}
          </Button>
          {data.emitError && <div className="px-3.5 py-3 rounded-lg bg-redBg text-red text-sm font-semibold">{data.emitError}</div>}
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <div className="flex items-center justify-between mb-1">
              <div className="font-bold text-[14.5px]">Checklist de lastro</div>
              <div className="text-[13px] font-extrabold" style={{ color: data.lastroChecklist.color }}>
                {data.lastroChecklist.pct}%
              </div>
            </div>
            <div className="text-textSecondary text-xs mb-3.5">Quanto mais completo, menor o risco percebido pelo financiador — e melhor a taxa</div>
            <div className="mb-4">
              <ProgressBar pct={data.lastroChecklist.pct} color={data.lastroChecklist.color} />
            </div>
            <div className="flex flex-col gap-2.5">
              {data.lastroChecklist.items.map((item) => (
                <div key={item.label} className="flex items-center gap-2.5">
                  <span className="rounded flex-shrink-0" style={{ width: 16, height: 16, border: `1.5px solid ${item.color}`, background: item.done ? item.color : 'transparent' }} />
                  <span className="text-[13px]" style={{ color: item.textColor }}>
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="px-6 py-5">
            <div className="font-bold text-sm mb-1">Limite pré-aprovado</div>
            <div className="text-[22px] font-extrabold text-blue mb-1">{fmtBRL(data.preApprovedLimit)}</div>
            <div className="text-textSecondary text-xs leading-snug">Com base no seu Checklist de Lastro atual e histórico de sacados já usados na plataforma</div>
          </Card>

          <Card className="px-6 py-5">
            <div className="font-bold text-sm mb-2.5">Desconto por volume mensal</div>
            <div className="flex flex-col gap-2 text-[12.5px]">
              {[
                { label: 'Até R$ 200 mil', rate: '0,35%', active: data.emitSummary.emitTotalValor > 0 && data.emitSummary.emitTotalValor <= 200000 },
                { label: 'R$ 200 mil – R$ 1 milhão', rate: '0,30%', active: data.emitSummary.emitTotalValor > 200000 && data.emitSummary.emitTotalValor <= 1000000 },
                { label: 'Acima de R$ 1 milhão', rate: '0,25%', active: data.emitSummary.emitTotalValor > 1000000 },
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
                <span className="font-bold font-mono-num">{data.emitSummary.valorFmt}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#9FB3D6]">Prêmio do seguro</span>
                <span className="font-bold font-mono-num">{data.emitSummary.premioFmt}</span>
              </div>
              <div className="h-px" style={{ background: 'rgba(255,255,255,0.14)' }} />
              <div className="flex justify-between">
                <span className="text-[#9FB3D6]">Registradoras</span>
                <span className="font-bold">CERC · B3 · Núclea</span>
              </div>
              <div className="h-px" style={{ background: 'rgba(255,255,255,0.14)' }} />
              <div className="flex justify-between">
                <span className="text-[#9FB3D6]">Taxa estimada (leilão)</span>
                <span className="font-bold font-mono-num text-[#4C8CFF]">{data.emitSummary.taxaEstimadaFmt}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#9FB3D6]">Sua taxa de plataforma</span>
                <span className="font-bold font-mono-num">{data.emitSummary.plataformaFeeFmt}</span>
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
