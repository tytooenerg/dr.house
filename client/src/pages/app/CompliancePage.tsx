import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { PageSkeleton } from '../../components/ui/Skeleton';
import { PageHeader, Card, NavyCard } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';

interface ComplianceData {
  trustBridge: { parte: string; veSobreo: string }[];
  financiadorReqs: { label: string; desc: string; color: string }[];
  cronograma: { label: string; periodo: string; status: string; statusBg: string; statusColor: string; dotColor: string }[];
  auditLog: { timestamp: string; ator: string; acao: string }[];
  fraudFlags: { text: string; color: string }[];
  contractFlags: { text: string; color: string }[];
  dupQuery: string;
  dupChecked: boolean;
  interop: { name: string; lastCheck: number }[];
  fidcPL: string;
  fidcOriginacaoFmt: string;
  fidcSpreadLabel: string;
}

export function CompliancePage() {
  const [data, setData] = useState<ComplianceData | null>(null);
  const [dupQuery, setDupQuery] = useState('');
  const [fidcPL, setFidcPL] = useState('5.000.000');

  useEffect(() => {
    api.get<ComplianceData>('/compliance').then((d) => {
      setData(d);
      setDupQuery(d.dupQuery);
      setFidcPL(d.fidcPL);
    });
  }, []);

  if (!data) return <PageSkeleton />;

  const runDupCheck = async () => {
    const d = await api.post<{ dupQuery: string; dupChecked: boolean }>('/compliance/dup-check', { query: dupQuery });
    setData((s) => (s ? { ...s, dupChecked: d.dupChecked } : s));
  };

  const updateFidc = async (value: string) => {
    setFidcPL(value);
    const d = await api.post<{ fidcOriginacaoFmt: string; fidcSpreadLabel: string }>('/compliance/fidc', { value });
    setData((s) => (s ? { ...s, fidcOriginacaoFmt: d.fidcOriginacaoFmt, fidcSpreadLabel: d.fidcSpreadLabel } : s));
  };

  return (
    <div>
      <PageHeader title="Central de Compliance" subtitle="Cronograma regulatório, verificação de duplicidade e trilha de auditoria" />

      <NavyCard className="mb-4">
        <div className="font-bold text-[15px] mb-1">A ponte de confiança — o que cada parte enxerga</div>
        <div className="text-[#9FB3D6] text-[12.5px] mb-4.5">Mesma duplicata, uma visão de segurança diferente para cada interessado</div>
        <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {data.trustBridge.map((t) => (
            <div key={t.parte} className="rounded-[10px] p-4" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <div className="font-bold text-[13px] mb-1.5">{t.parte}</div>
              <div className="text-[#9FB3D6] text-xs leading-snug">{t.veSobreo}</div>
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
                <span className="font-bold text-[13.5px]">{r.name}</span>
              </div>
              <div className="text-textSecondary text-xs leading-snug">Sincronização em tempo real · última verificação há {r.lastCheck}s</div>
            </div>
          ))}
        </div>
        <div className="mt-3.5 px-3.5 py-3 rounded-lg bg-greenBg text-[12.5px] text-green font-semibold">
          Nenhum evento de cessão simultânea detectado — titularidade consistente entre as três registradoras
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
                <div className="font-semibold text-[13.5px]">{req.label}</div>
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
                <div className="font-semibold text-[13.5px]">{c.label}</div>
                <div className="text-textSecondary text-[12.5px]">{c.periodo}</div>
              </div>
              <span className="text-[11.5px] font-bold px-2.5 py-1 rounded-md" style={{ background: c.statusBg, color: c.statusColor }}>
                {c.status}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mb-4">
        <div className="font-bold text-[15px] mb-3.5">Verificação de duplicidade</div>
        <div className="flex gap-2.5 max-w-[520px]">
          <Input placeholder="CNPJ do sacado ou nº da duplicata" value={dupQuery} onChange={(e) => setDupQuery(e.target.value)} />
          <Button onClick={runDupCheck}>Consultar registradoras</Button>
        </div>
        {data.dupChecked && (
          <div className="mt-4 p-4 rounded-[10px] bg-greenBg" style={{ border: '1px solid #CFE6D9' }}>
            <div className="font-bold text-[13.5px] text-green">Nenhuma duplicidade encontrada</div>
            <div className="text-[12.5px] mt-1" style={{ color: '#3D6B54' }}>
              Consultado em tempo real: CERC ✓ · B3 ✓ · Núclea ✓ — titularidade única confirmada
            </div>
          </div>
        )}
      </Card>

      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Card>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10.5px] font-extrabold px-2 py-1 rounded-md bg-chip text-blue">IA</span>
            <div className="font-bold text-[14.5px]">Detecção de fraude</div>
          </div>
          <div className="text-textSecondary text-[12.5px] mb-3.5">Varredura contínua em busca de valores incompatíveis, sacados recém-criados e reuso de NF-e</div>
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
            <span className="text-[10.5px] font-extrabold px-2 py-1 rounded-md bg-chip text-blue">IA</span>
            <div className="font-bold text-[14.5px]">Leitura de contratos</div>
          </div>
          <div className="text-textSecondary text-[12.5px] mb-3.5">Análise automática de contratos de cessão em busca de cláusulas incompatíveis com a duplicata escritural</div>
          <div className="flex flex-col gap-2">
            {data.contractFlags.map((cf, i) => (
              <div key={i} className="flex items-center gap-2 text-[12.5px]">
                <span className="rounded-full flex-shrink-0" style={{ width: 6, height: 6, background: cf.color }} />
                <span>{cf.text}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

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
