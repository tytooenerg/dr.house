import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { PageHeader, Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { useLang } from '../../lib/i18n';

interface PayableView {
  id: number;
  descricao: string;
  fornecedor: string;
  categoria: string;
  valor: number;
  valorFmt: string;
  vencimento: string;
  status: 'pendente' | 'pago' | 'cancelado';
  atrasado: boolean;
  recorrente: boolean;
  paidAt: string | null;
}

interface PayablesOverview {
  items: PayableView[];
  totalPendenteFmt: string;
  totalAtrasadoFmt: string;
  totalPendente: number;
  totalAtrasado: number;
  countAtrasado: number;
}

const CATEGORIA_LABELS: Record<string, string> = {
  fornecedores: 'Fornecedores',
  folha: 'Folha de pagamento',
  impostos: 'Impostos',
  aluguel: 'Aluguel',
  outros: 'Outros',
};

const STATUS_STYLE: Record<PayableView['status'], { label: string; bg: string; color: string }> = {
  pendente: { label: 'Pendente', bg: '#FBF1E0', color: '#9A6B10' },
  pago: { label: 'Pago', bg: '#EAF3EE', color: '#0A5C36' },
  cancelado: { label: 'Cancelado', bg: '#F1F2F5', color: '#5B6472' },
};

interface LoteRowResult {
  index: number;
  descricao: string;
  ok: boolean;
  id?: number;
  error?: string;
}
interface LoteOutcome {
  total: number;
  sucesso: number;
  falhas: number;
  resultados: LoteRowResult[];
}

const CSV_TEMPLATE = 'descricao,fornecedor,categoria,valor,vencimento,recorrente\nAluguel do escritório,Imobiliária X,aluguel,5000,2026-12-01,1\n';

// Same client-side-parse-then-post-JSON pattern as EmitirPage's LoteEmissaoCard — no file
// leaves the browser as a raw upload, just parsed rows posted as the same shape a manual
// single entry uses, each row created through the exact same addPayable() path server-side.
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

function LoteImportCard({ onImported }: { onImported: () => void }) {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState<LoteOutcome | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setError('');
    setOutcome(null);
    setFileName(file.name);
    const parsed = parseCsv(await file.text());
    if (parsed.length === 0) {
      setError('Nenhuma linha reconhecida no arquivo. Use o modelo (cabeçalho: descricao,fornecedor,categoria,valor,vencimento,recorrente).');
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
        descricao: r.descricao ?? '',
        fornecedor: r.fornecedor ?? '',
        categoria: r.categoria || 'outros',
        valor: r.valor ?? '',
        vencimento: r.vencimento ?? '',
        recorrente: r.recorrente === '1' || r.recorrente?.toLowerCase() === 'true',
      }));
      const data = await api.post<LoteOutcome>('/payables/lote', { rows: payload });
      setOutcome(data);
      if (data.falhas === 0) {
        setRows([]);
        setFileName('');
        onImported();
      } else {
        await onImported();
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
    a.download = 'modelo-contas-a-pagar-lote.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="mb-6">
      <div className="flex items-center justify-between mb-1">
        <div className="font-bold text-[15px]">Importar em lote (CSV)</div>
        <button type="button" onClick={downloadTemplate} className="bg-transparent border-none text-blue text-xs font-bold cursor-pointer">
          Baixar modelo CSV
        </button>
      </div>
      <p className="text-[12.5px] text-textSecondary mb-3">
        Para cedentes com muitas obrigações — importa várias contas de uma vez (até 200 linhas), cada uma pelo mesmo caminho de um lançamento
        manual. Colunas: <code>descricao,fornecedor,categoria,valor,vencimento,recorrente</code>.
      </p>
      <input
        ref={fileRef}
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
        onClick={() => fileRef.current?.click()}
        className="w-full border-2 border-dashed border-[#C7D0DE] rounded-xl p-4 text-center cursor-pointer bg-transparent mb-3"
      >
        <div className="font-bold text-[13px]">{fileName ? `${fileName} — ${rows.length} linha(s) reconhecida(s)` : 'Selecionar arquivo CSV'}</div>
      </button>
      {rows.length > 0 && (
        <Button disabled={busy} onClick={enviarLote} className="mb-3">
          {busy ? 'Importando…' : `Importar ${rows.length} conta(s)`}
        </Button>
      )}
      {error && <div className="px-3.5 py-3 rounded-lg bg-redBg text-red text-sm font-semibold mb-3">{error}</div>}
      {outcome && (
        <div>
          <div className="text-[12.5px] font-bold mb-2">
            {outcome.sucesso} de {outcome.total} importada(s) com sucesso{outcome.falhas > 0 ? ` — ${outcome.falhas} falha(s)` : ''}
          </div>
          <div className="flex flex-col gap-1.5">
            {outcome.resultados
              .filter((r) => !r.ok)
              .map((r) => (
                <div key={r.index} className="flex items-center justify-between text-[12px] px-2.5 py-1.5 rounded-md bg-[#F7E9E7]">
                  <span className="font-semibold">{r.descricao || `linha ${r.index + 1}`}</span>
                  <span className="text-red">{r.error}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </Card>
  );
}

export function ContasPagarPage() {
  const { t } = useLang();
  const [overview, setOverview] = useState<PayablesOverview | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showLote, setShowLote] = useState(false);
  const [form, setForm] = useState({ descricao: '', fornecedor: '', categoria: 'outros', valor: '', vencimento: '', recorrente: false });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = () => {
    setLoadError(null);
    return api
      .get<PayablesOverview>('/payables')
      .then(setOverview)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Falha ao carregar contas a pagar.'));
  };

  useEffect(() => {
    load();
  }, []);

  const resetForm = () => setForm({ descricao: '', fornecedor: '', categoria: 'outros', valor: '', vencimento: '', recorrente: false });

  const submit = async () => {
    setFormError('');
    const valor = Number(form.valor.replace(',', '.'));
    if (!form.descricao.trim()) {
      setFormError('Informe uma descrição.');
      return;
    }
    if (!valor || valor <= 0) {
      setFormError('Informe um valor válido.');
      return;
    }
    if (!form.vencimento) {
      setFormError('Informe o vencimento.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/payables', { ...form, valor, categoria: form.categoria });
      resetForm();
      setShowForm(false);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Não foi possível criar a conta a pagar.');
    } finally {
      setSaving(false);
    }
  };

  const act = async (id: number, action: 'pagar' | 'cancelar' | 'excluir') => {
    setError('');
    setBusyId(id);
    try {
      if (action === 'excluir') await api.del(`/payables/${id}`);
      else await api.post(`/payables/${id}/${action}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível atualizar a conta a pagar.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <PageHeader
        title={t('contasPagar.title', 'Contas a Pagar')}
        subtitle={t(
          'contasPagar.subtitle',
          'Suas obrigações reais (fornecedores, folha, impostos, aluguel) — a mesma base que alimenta a projeção de caixa em AI CFO',
        )}
        right={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setShowLote((v) => !v)}>
              {showLote ? 'Fechar importação' : 'Importar CSV'}
            </Button>
            <Button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Fechar' : '+ Nova conta'}</Button>
          </div>
        }
      />

      {loadError && <ErrorState message={loadError} onRetry={load} />}

      {!loadError && overview && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <Card>
            <div className="text-[11.5px] font-bold text-textSecondary uppercase mb-1.5">Total pendente</div>
            <div className="font-mono-num font-bold text-lg">{overview.totalPendenteFmt}</div>
          </Card>
          <Card>
            <div className="text-[11.5px] font-bold text-textSecondary uppercase mb-1.5">Em atraso ({overview.countAtrasado})</div>
            <div className="font-mono-num font-bold text-lg" style={{ color: overview.countAtrasado > 0 ? '#B3261E' : undefined }}>
              {overview.totalAtrasadoFmt}
            </div>
          </Card>
        </div>
      )}

      {showLote && <LoteImportCard onImported={load} />}

      {showForm && (
        <Card className="mb-6">
          <div className="font-bold text-[15px] mb-3">Nova conta a pagar</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <input
              placeholder="Descrição"
              value={form.descricao}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              className="border border-border rounded-md px-3 py-2 text-sm md:col-span-1"
            />
            <input
              placeholder="Fornecedor (opcional)"
              value={form.fornecedor}
              onChange={(e) => setForm({ ...form, fornecedor: e.target.value })}
              className="border border-border rounded-md px-3 py-2 text-sm"
            />
            <select
              value={form.categoria}
              onChange={(e) => setForm({ ...form, categoria: e.target.value })}
              className="border border-border rounded-md px-3 py-2 text-sm"
            >
              {Object.entries(CATEGORIA_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            <input
              type="text"
              inputMode="decimal"
              placeholder="Valor em R$"
              value={form.valor}
              onChange={(e) => setForm({ ...form, valor: e.target.value })}
              className="border border-border rounded-md px-3 py-2 text-sm"
            />
            <input
              type="date"
              value={form.vencimento}
              onChange={(e) => setForm({ ...form, vencimento: e.target.value })}
              className="border border-border rounded-md px-3 py-2 text-sm"
            />
            <label className="flex items-center gap-2 text-[13px] text-textSecondary">
              <input type="checkbox" checked={form.recorrente} onChange={(e) => setForm({ ...form, recorrente: e.target.checked })} />
              Recorrente (mensal)
            </label>
          </div>
          <Button disabled={saving} onClick={submit}>
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
          {formError && <div className="mt-2.5 text-red text-[12.5px] font-semibold">{formError}</div>}
        </Card>
      )}

      {error && <div className="mb-3 text-red text-[12.5px] font-semibold">{error}</div>}

      {!loadError && (
      <Card>
        {!overview || overview.items.length === 0 ? (
          <EmptyState title="Nenhuma conta a pagar" hint="Cadastre suas obrigações para ver a projeção de caixa considerá-las em AI CFO" />
        ) : (
          <div className="flex flex-col gap-2">
            {overview.items.map((p) => {
              const st = STATUS_STYLE[p.status];
              return (
                <div key={p.id} className="flex items-center justify-between gap-3 border-b border-border last:border-b-0 pb-3 pt-1 flex-wrap text-[13px]">
                  <div className="min-w-[180px]">
                    <div className="font-semibold">{p.descricao}</div>
                    <div className="text-textSecondary text-[11.5px] mt-0.5">
                      {CATEGORIA_LABELS[p.categoria] ?? p.categoria}
                      {p.fornecedor ? ` · ${p.fornecedor}` : ''}
                      {p.recorrente ? ' · recorrente' : ''}
                    </div>
                  </div>
                  <div className="text-textSecondary">{p.vencimento}</div>
                  <div className="font-mono-num font-bold">{p.valorFmt}</div>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-md" style={{ background: st.bg, color: st.color }}>
                    {p.atrasado ? 'Atrasado' : st.label}
                  </span>
                  {p.status === 'pendente' && (
                    <div className="flex items-center gap-1.5">
                      <Button size="sm" variant="success" disabled={busyId === p.id} onClick={() => act(p.id, 'pagar')}>
                        Marcar pago
                      </Button>
                      <Button size="sm" variant="secondary" disabled={busyId === p.id} onClick={() => act(p.id, 'cancelar')}>
                        Cancelar
                      </Button>
                      <Button size="sm" variant="danger" disabled={busyId === p.id} onClick={() => act(p.id, 'excluir')}>
                        Excluir
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
      )}
    </div>
  );
}
