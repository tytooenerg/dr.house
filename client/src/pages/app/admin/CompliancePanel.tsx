import { useEffect, useState } from 'react';
import { api, downloadFile } from '../../../lib/api';
import { Button } from '../../../components/ui/Button';
import { EmptyState } from '../../../components/ui/EmptyState';

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


const SAR_TIPO_LABELS: Record<string, string> = {
  fracionamento: 'Fracionamento',
  entrada_saida_rapida: 'Entrada/saída rápida',
};

// Tudo que trata de risco regulatório/financeiro do marketplace num só lugar: fila de
// suspensão automática do Compliance AI Engine, monitor de PLD (SARs) e informes CVM/DARF
// (documentos de apoio, não protocolos formais — ver disclaimers inline).
export function CompliancePanel({ onCount }: { onCount?: (n: number) => void }) {
  const [complianceQueue, setComplianceQueue] = useState<ComplianceQueueItem[]>([]);
  const [complianceNoteById, setComplianceNoteById] = useState<Record<string, string>>({});
  const [threshold, setThreshold] = useState<{ threshold: number; default: number } | null>(null);
  const [thresholdInput, setThresholdInput] = useState('');
  const [savingThreshold, setSavingThreshold] = useState(false);
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
  const [darfPeriod, setDarfPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [downloadingDarf, setDownloadingDarf] = useState(false);

  const loadCompliance = () => api.get<{ pending: ComplianceQueueItem[] }>('/admin/compliance-queue').then((d) => setComplianceQueue(d.pending));
  const loadThreshold = () =>
    api.get<{ threshold: number; default: number }>('/admin/compliance-threshold').then((d) => {
      setThreshold(d);
      setThresholdInput(String(d.threshold));
    });
  const loadSar = () =>
    api.get<{ reports: SarReport[]; threshold: number }>('/admin/pld/suspeitas?status=aberto').then((d) => {
      setSarReports(d.reports);
      setSarThreshold(d.threshold);
      setSarThresholdInput(String(d.threshold));
    });
  useEffect(() => {
    loadCompliance();
    loadThreshold();
    loadSar();
  }, []);

  useEffect(() => {
    onCount?.(complianceQueue.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complianceQueue.length]);

  const saveThreshold = async () => {
    const n = Number(thresholdInput);
    if (!Number.isInteger(n) || n < 1 || n > 100) return;
    setSavingThreshold(true);
    try {
      await api.put('/admin/compliance-threshold', { threshold: n });
      await loadThreshold();
    } finally {
      setSavingThreshold(false);
    }
  };

  const decideCompliance = async (duplicataId: string, decision: 'liberado' | 'rejeitado') => {
    const note = complianceNoteById[duplicataId]?.trim();
    if (!note) return;
    await api.post(`/admin/compliance-queue/${duplicataId}/decidir`, { decision, note });
    loadCompliance();
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

  const dismissSar = async (id: number) => {
    setSarActionId(id);
    try {
      await api.post(`/admin/pld/suspeitas/${id}/descartar`);
      await loadSar();
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
    } finally {
      setSarActionId(null);
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

  const downloadDarf = async () => {
    setDownloadingDarf(true);
    try {
      await downloadFile(`/admin/juridico/darf.pdf?period=${darfPeriod}`, `darf-irrf-${darfPeriod}.pdf`);
    } finally {
      setDownloadingDarf(false);
    }
  };

  return (
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
        <div className="font-bold text-[14px] mb-1">DARF — IRRF agregado sobre resgates do período</div>
        <div className="text-textSecondary text-[12.5px] mb-3">
          Mesmo cálculo de IR pela tabela regressiva da Central Fiscal do investidor, agregado por período de resgate — documento de apoio ao
          recolhimento, não uma guia protocolada. Lastro não retém IR automaticamente hoje.
        </div>
        <div className="flex items-center gap-2.5">
          <input
            type="month"
            className="px-3 py-2 rounded-md border border-inputBorder text-[13px]"
            value={darfPeriod}
            onChange={(e) => setDarfPeriod(e.target.value)}
          />
          <Button size="sm" variant="secondary" disabled={downloadingDarf} onClick={downloadDarf}>
            {downloadingDarf ? 'Gerando…' : 'Baixar DARF (PDF)'}
          </Button>
        </div>
      </div>
    </div>
  );
}
