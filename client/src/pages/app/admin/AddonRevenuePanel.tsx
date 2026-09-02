import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { Button } from '../../../components/ui/Button';
import { EmptyState } from '../../../components/ui/EmptyState';

type AddOnKind =
  | 'api_overage'
  | 'score_api'
  | 'pld_screening_api'
  | 'registro_api'
  | 'whitelabel_plus'
  | 'institutional_reporting'
  | 'judicial_records_api'
  | 'fraud_screening_api'
  | 'document_intelligence_api'
  | 'reconciliation_api'
  | 'suitability_api'
  | 'market_index_api'
  | 'publicidade_carrossel';

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
  registro_api: 'Registro API avulsa (por chamada)',
  whitelabel_plus: 'White-label Plus (mensal)',
  institutional_reporting: 'Relatórios Institucionais (mensal)',
  judicial_records_api: 'Judicial Records API avulsa (por chamada)',
  fraud_screening_api: 'Fraud Screening API avulsa (por chamada)',
  document_intelligence_api: 'Document Intelligence API avulsa (por chamada)',
  reconciliation_api: 'Reconciliation API avulsa (por chamada)',
  suitability_api: 'Suitability API avulsa (por chamada)',
  market_index_api: 'Lastro Index avulso (por chamada)',
  publicidade_carrossel: 'Carrossel de publicidade (mensal)',
};

export function AddonRevenuePanel() {
  const [addonPrices, setAddonPrices] = useState<AddonPrice[]>([]);
  const [addonPriceInputs, setAddonPriceInputs] = useState<Record<string, string>>({});
  const [savingAddonKind, setSavingAddonKind] = useState<AddOnKind | null>(null);
  const [addonResumo, setAddonResumo] = useState<AddonChargeSummary[]>([]);
  const [addonRecentes, setAddonRecentes] = useState<AddonRecentCharge[]>([]);
  const [includedCalls, setIncludedCalls] = useState<number | null>(null);
  const [includedCallsInput, setIncludedCallsInput] = useState('');
  const [savingIncluded, setSavingIncluded] = useState(false);
  const [runningAddonJob, setRunningAddonJob] = useState<string | null>(null);

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

  useEffect(() => {
    loadAddonPrices();
    loadAddonCobrancas();
    loadApiOverageConfig();
  }, []);

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

  return (
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
  );
}
