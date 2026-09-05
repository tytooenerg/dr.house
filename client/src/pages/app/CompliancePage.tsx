import { useEffect, useRef, useState } from 'react';
import { api, downloadFile, uploadFile, ApiError } from '../../lib/api';
import { PageSkeleton } from '../../components/ui/Skeleton';
import { PageHeader, Card, NavyCard } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { ErrorState } from '../../components/ui/ErrorState';
import { ComplianceCalendarCard } from '../../components/ComplianceCalendarCard';
import { PALETTE } from '../../lib/palette';

interface DupGroup {
  valorFmt: string;
  vencimento: string;
  ocorrencias: { id: string; cedenteNome: string; registradora: string | null }[];
  duplicidadeSuspeita: boolean;
  confirmadoNaRegistradora: boolean | null;
}

interface DupCheckResponse {
  dupQuery: string;
  dupChecked: boolean;
  duplicidadeEncontrada: boolean;
  matches: DupGroup[];
}

interface ProvisioningRow {
  duplicataId: string;
  sacadoNome: string;
  valorFmt: string;
  vencimento: string;
  diasAtraso: number;
  estagio: 'estagio_1' | 'estagio_2' | 'estagio_3';
  estagioLabel: string;
}

interface ComplianceData {
  trustBridge: { parte: string; veSobreo: string }[];
  financiadorReqs: { label: string; desc: string; color: string }[];
  cronograma: { label: string; periodo: string; status: string; statusBg: string; statusColor: string; dotColor: string }[];
  auditLog: { timestamp: string; ator: string; acao: string }[];
  fraudFlags: { text: string; color: string }[];
  contractFlags: { text: string; color: string }[];
  contractFlagsReal: boolean;
  contractAnalyzedFilename: string | null;
  interop: { name: string; lastCheck: string }[];
  fidcPL: string;
  fidcOriginacaoFmt: string;
  fidcSpreadLabel: string;
}

export function CompliancePage() {
  const [data, setData] = useState<ComplianceData | null>(null);
  const [dupQuery, setDupQuery] = useState('');
  const [dupResult, setDupResult] = useState<DupCheckResponse | null>(null);
  const [fidcPL, setFidcPL] = useState('5.000.000');
  const [provisioning, setProvisioning] = useState<{ rows: ProvisioningRow[]; summary: Record<string, number> } | null>(null);
  const [analyzingContract, setAnalyzingContract] = useState(false);
  const [contractError, setContractError] = useState<string | null>(null);
  const contractFileInput = useRef<HTMLInputElement>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadAll = () => {
    setLoadError(null);
    Promise.all([
      api.get<ComplianceData>('/compliance').then((d) => {
        setData(d);
        setFidcPL(d.fidcPL);
      }),
      api.get<{ rows: ProvisioningRow[]; summary: Record<string, number> }>('/compliance/provisionamento').then(setProvisioning),
    ]).catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Falha ao carregar Compliance.'));
  };

  useEffect(() => {
    loadAll();
  }, []);

  if (loadError) return <ErrorState message={loadError} onRetry={loadAll} />;
  if (!data) return <PageSkeleton />;

  const runDupCheck = async () => {
    const d = await api.post<DupCheckResponse>('/compliance/dup-check', { query: dupQuery });
    setDupResult(d);
  };

  const updateFidc = async (value: string) => {
    setFidcPL(value);
    const d = await api.post<{ fidcOriginacaoFmt: string; fidcSpreadLabel: string }>('/compliance/fidc', { value });
    setData((s) => (s ? { ...s, fidcOriginacaoFmt: d.fidcOriginacaoFmt, fidcSpreadLabel: d.fidcSpreadLabel } : s));
  };

  const uploadContract = async (file: File) => {
    setAnalyzingContract(true);
    setContractError(null);
    try {
      const res = await uploadFile('contrato_cessao', file);
      if (!res.analysis) {
        setContractError('Não foi possível analisar o contrato agora (ANTHROPIC_API_KEY não configurada ou análise indisponível).');
        return;
      }
      const SEVERITY_COLOR: Record<string, string> = { ok: PALETTE.green, atencao: PALETTE.amber, critico: PALETTE.red };
      setData((s) =>
        s
          ? {
              ...s,
              contractFlags: res.analysis!.map((f) => ({ text: f.text, color: SEVERITY_COLOR[f.severity] || PALETTE.textSecondary })),
              contractFlagsReal: true,
              contractAnalyzedFilename: file.name,
            }
          : s
      );
    } catch {
      setContractError('Falha ao enviar o contrato.');
    } finally {
      setAnalyzingContract(false);
    }
  };

  return (
    <div>
      <PageHeader title="Central de Compliance" subtitle="Cronograma regulatório, verificação de duplicidade e trilha de auditoria" />

      <NavyCard className="mb-4">
        <div className="font-bold text-[15px] mb-1">A ponte de confiança — o que cada parte enxerga</div>
        <div className="text-onNavy text-[12.5px] mb-4.5">Mesma duplicata, uma visão de segurança diferente para cada interessado</div>
        <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {data.trustBridge.map((t) => (
            <div key={t.parte} className="rounded-[10px] p-4" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <div className="font-bold text-[13px] mb-1.5">{t.parte}</div>
              <div className="text-onNavy text-xs leading-snug">{t.veSobreo}</div>
            </div>
          ))}
        </div>
      </NavyCard>

      <Card className="mb-4">
        <div className="font-bold text-[15px] mb-1">Interoperabilidade entre registradoras</div>
        <div className="text-textSecondary text-[12.5px] mb-4">A Lastro já resolve o gargalo de sincronização entre CERC, B3 e Núclea que hoje afeta o mercado</div>
        <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {data.interop.map((r) => (
            <div key={r.name} className="p-4 rounded-[10px] bg-bg">
              <div className="flex items-center gap-2 mb-2">
                <span className="rounded-full bg-green" style={{ width: 8, height: 8 }} />
                <span className="font-bold text-[13px]">{r.name}</span>
              </div>
              <div className="text-textSecondary text-xs leading-snug">Roteamento inteligente ativo · última operação: {r.lastCheck}</div>
            </div>
          ))}
        </div>
        <div className="mt-3.5 px-3.5 py-3 rounded-lg text-[12.5px]" style={{ background: PALETTE.amberBg, color: PALETTE.amber }}>
          O roteamento entre registradoras é real; a consulta cruzada de duplicidade contra as APIs oficiais da CERC/B3/Núclea ainda depende de integração comercial — hoje a verificação abaixo cobre apenas a base da própria Lastro.
        </div>
      </Card>

      <Card className="mb-4">
        <div className="font-bold text-[15px] mb-1">Simulador de originação para FIDCs</div>
        <div className="text-textSecondary text-[12.5px] mb-4">Quanto seu fundo pode originar via Lastro por mês</div>
        <div className="grid gap-5 items-center" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div>
            <div className="text-xs font-bold text-textSecondary mb-2">Patrimônio líquido disponível para alocação (R$)</div>
            <Input mono value={fidcPL} onChange={(e) => updateFidc(e.target.value)} />
          </div>
          <div className="flex gap-6">
            <div>
              <div className="text-textSecondary text-xs font-semibold">Originação mensal estimada</div>
              <div className="text-xl font-extrabold font-mono-num mt-1">{data.fidcOriginacaoFmt}</div>
            </div>
            <div>
              <div className="text-textSecondary text-xs font-semibold">Rentabilidade líquida estimada</div>
              <div className="text-xl font-extrabold font-mono-num mt-1 text-green">CDI + {data.fidcSpreadLabel}</div>
            </div>
          </div>
        </div>
      </Card>

      <Card className="mb-4">
        <div className="font-bold text-[15px] mb-1">Requisitos do financiador (Res. CMN 4.815/2020 e 5.094/2023)</div>
        <div className="text-textSecondary text-[12.5px] mb-4">O que bancos e financiadores exigem para aceitar uma duplicata como garantia de crédito ou antecipação</div>
        <div className="flex flex-col gap-3.5">
          {data.financiadorReqs.map((req) => (
            <div key={req.label} className="flex items-start gap-3">
              <span className="rounded-[5px] flex-shrink-0 mt-0.5 flex items-center justify-center" style={{ width: 18, height: 18, border: `2px solid ${req.color}` }}>
                <span className="rounded-[2px]" style={{ width: 8, height: 8, background: req.color }} />
              </span>
              <div>
                <div className="font-semibold text-[13px]">{req.label}</div>
                <div className="text-textSecondary text-[12.5px] mt-0.5 leading-snug">{req.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mb-4">
        <div className="font-bold text-[15px] mb-4.5">Cronograma de obrigatoriedade — Duplicata Escritural (BCB)</div>
        <div className="flex flex-col gap-3.5">
          {data.cronograma.map((c) => (
            <div key={c.label} className="flex items-center gap-3.5">
              <span className="rounded-full flex-shrink-0" style={{ width: 10, height: 10, background: c.dotColor }} />
              <div className="flex-1">
                <div className="font-semibold text-[13px]">{c.label}</div>
                <div className="text-textSecondary text-[12.5px]">{c.periodo}</div>
              </div>
              <span className="text-[11.5px] font-bold px-2.5 py-1 rounded-md" style={{ background: c.statusBg, color: c.statusColor }}>
                {c.status}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <ComplianceCalendarCard />

      <Card className="mb-4">
        <div className="font-bold text-[15px] mb-1">Verificação de duplicidade</div>
        <div className="text-textSecondary text-[12.5px] mb-3.5">Consulta real contra a base de duplicatas da própria Lastro (CNPJ do sacado, chave de NF-e ou nº da duplicata)</div>
        <div className="flex gap-2.5 max-w-[520px]">
          <Input placeholder="CNPJ do sacado, chave de NF-e ou nº da duplicata" value={dupQuery} onChange={(e) => setDupQuery(e.target.value)} />
          <Button onClick={runDupCheck}>Consultar</Button>
        </div>
        {dupResult && dupResult.matches.length === 0 && (
          <div className="mt-4 p-4 rounded-[10px] bg-greenBg" style={{ border: `1px solid ${PALETTE.greenBorder}` }}>
            <div className="font-bold text-[13px] text-green">Nenhum registro encontrado para esta consulta</div>
          </div>
        )}
        {dupResult && dupResult.matches.length > 0 && (
          <div className="mt-4 flex flex-col gap-2.5">
            {dupResult.matches.map((m, i) => (
              <div
                key={i}
                className="p-4 rounded-[10px]"
                style={m.duplicidadeSuspeita ? { background: PALETTE.redBg, border: `1px solid ${PALETTE.redBorder}` } : { background: PALETTE.surface }}
              >
                <div className="font-bold text-[13px]" style={{ color: m.duplicidadeSuspeita ? PALETTE.red : undefined }}>
                  {m.duplicidadeSuspeita ? 'Possível duplicidade — ' : ''}
                  {m.valorFmt} · vencimento {m.vencimento} · {m.ocorrencias.length} registro{m.ocorrencias.length > 1 ? 's' : ''}
                </div>
                <div className="text-[11.5px] font-semibold mt-1 text-textSecondary">
                  {m.confirmadoNaRegistradora === null
                    ? 'Verificado apenas na base da Lastro — registradora não configurada para checagem direta'
                    : m.confirmadoNaRegistradora
                      ? 'Duplicidade confirmada diretamente na registradora'
                      : 'Confirmado como não-duplicado diretamente na registradora'}
                </div>
                <div className="text-[12.5px] mt-1.5 flex flex-col gap-0.5" style={{ color: m.duplicidadeSuspeita ? PALETTE.red : undefined }}>
                  {m.ocorrencias.map((o) => (
                    <div key={o.id}>
                      {o.id} — {o.cedenteNome} {o.registradora ? `(${o.registradora})` : ''}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Card>
          <div className="flex items-center gap-2 mb-1.5">
            <div className="font-bold text-[14px]">Detecção de fraude</div>
          </div>
          <div className="text-textSecondary text-[12.5px] mb-3.5">Calculado em tempo real a partir das duplicatas emitidas: valores fora do padrão histórico do sacado e tentativas de reuso de NF-e</div>
          <div className="flex flex-col gap-2">
            {data.fraudFlags.map((fl, i) => (
              <div key={i} className="flex items-center gap-2 text-[12.5px]">
                <span className="rounded-full flex-shrink-0" style={{ width: 6, height: 6, background: fl.color }} />
                <span>{fl.text}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-2 mb-1.5">
            {!data.contractFlagsReal && <span className="text-[10.5px] font-extrabold px-2 py-1 rounded-md bg-chip text-blue">Simulado</span>}
            <div className="font-bold text-[14px]">Leitura de contratos</div>
          </div>
          <div className="text-textSecondary text-[12.5px] mb-3.5">
            {data.contractFlagsReal
              ? `Análise real via IA do contrato enviado (${data.contractAnalyzedFilename}) — cláusulas incompatíveis com a duplicata escritural.`
              : 'Envie um contrato de cessão para uma análise real via IA em busca de cláusulas incompatíveis com a duplicata escritural — os itens abaixo são apenas um exemplo até o primeiro envio.'}
          </div>
          <div className="flex flex-col gap-2 mb-3.5">
            {data.contractFlags.map((cf, i) => (
              <div key={i} className="flex items-center gap-2 text-[12.5px]">
                <span className="rounded-full flex-shrink-0" style={{ width: 6, height: 6, background: cf.color }} />
                <span>{cf.text}</span>
              </div>
            ))}
          </div>
          <input
            ref={contractFileInput}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadContract(file);
              e.target.value = '';
            }}
          />
          <Button variant="secondary" disabled={analyzingContract} onClick={() => contractFileInput.current?.click()}>
            {analyzingContract ? 'Analisando…' : 'Enviar contrato de cessão (PDF)'}
          </Button>
          {contractError && <div className="text-[11.5px] text-red-600 mt-2">{contractError}</div>}
        </Card>
      </div>

      {provisioning && (
        <Card className="mb-4">
          <div className="font-bold text-[15px] mb-1">Provisionamento por estágio de risco (Res. CMN 4.966)</div>
          <div className="text-textSecondary text-[12.5px] mb-4">Suas posições compradas e ainda ativas, classificadas por dias de atraso desde o vencimento</div>
          <div className="grid gap-3.5 mb-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {([
              ['estagio_1', 'Estágio 1 — em dia (até 30d)', PALETTE.green],
              ['estagio_2', 'Estágio 2 — atraso 31–90d', PALETTE.amber],
              ['estagio_3', 'Estágio 3 — atraso > 90d', PALETTE.red],
            ] as [string, string, string][]).map(([key, label, color]) => (
              <div key={key} className="p-4 rounded-[10px] bg-bg">
                <div className="text-textSecondary text-xs mb-1">{label}</div>
                <div className="text-xl font-extrabold" style={{ color }}>
                  {provisioning.summary[key] ?? 0}
                </div>
              </div>
            ))}
          </div>
          {provisioning.rows.length > 0 && (
            <button
              type="button"
              onClick={() => downloadFile('/compliance/provisionamento/export.csv', 'provisionamento.csv')}
              className="text-blue text-[12.5px] font-bold bg-transparent border-none cursor-pointer p-0"
            >
              Exportar CSV para o modelo de provisionamento
            </button>
          )}
        </Card>
      )}

      <div className="bg-white border border-border rounded-card overflow-hidden">
        <div className="px-5 py-4.5 font-bold text-[15px] border-b border-border">Trilha de auditoria</div>
        {data.auditLog.map((a, i) => (
          <div key={i} className="grid gap-3 px-5 py-3.5 border-b border-hairline last:border-b-0 items-center text-[13px]" style={{ gridTemplateColumns: '1fr 1.3fr 1.6fr' }}>
            <div className="text-textSecondary font-mono-num">{a.timestamp}</div>
            <div className="font-semibold">{a.ator}</div>
            <div className="text-textSecondary">{a.acao}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
