import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { PageHeader, Card, NavyCard } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';

interface KycItem {
  label: string;
  status: string;
  bg: string;
  color: string;
  action: { label: string; key: string } | null;
}
interface ExtratoRow {
  data: string;
  descricao: string;
  valorFmt: string;
  isPositive: boolean;
  saldoFmt: string;
}
interface AccountData {
  kycChecklist: KycItem[];
  bankAccountDisplay: string;
  settlementSpeed: 'd0' | 'd1';
  extrato: ExtratoRow[];
}

export function ContaPage() {
  const [data, setData] = useState<AccountData | null>(null);

  const load = () => api.get<AccountData>('/account').then(setData);

  useEffect(() => {
    load();
  }, []);

  if (!data) return null;

  const runAction = async (key: string) => {
    if (key === 'bank') await api.post('/account/kyc/bank');
    if (key === 'docs') await api.post('/account/kyc/docs');
    load();
  };

  const setSpeed = async (speed: 'd0' | 'd1') => {
    const d = await api.post<AccountData>('/account/settlement-speed', { speed });
    setData(d);
  };

  return (
    <div>
      <PageHeader title="Conta & Liquidação" subtitle="Verificação da empresa, conta bancária e como a Lastro monetiza cada operação" />

      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Card>
          <div className="font-bold text-[15px] mb-4">Verificação (KYC)</div>
          <div className="flex flex-col gap-3">
            {data.kycChecklist.map((k) => (
              <div key={k.label} className="flex items-center justify-between gap-2.5">
                <div className="text-[13.5px] font-semibold">{k.label}</div>
                <div className="flex items-center gap-2">
                  {k.action && (
                    <button type="button" onClick={() => runAction(k.action!.key)} className="px-2.5 py-1.5 rounded-md border-none bg-blue text-white text-[11.5px] font-bold cursor-pointer">
                      {k.action.label}
                    </button>
                  )}
                  <span className="text-[11.5px] font-bold px-2.5 py-1 rounded-md" style={{ background: k.bg, color: k.color }}>
                    {k.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div className="font-bold text-[15px] mb-4">Conta bancária para liquidação</div>
          <div className="p-3.5 rounded-[10px] bg-[#F7F8FA] text-[13.5px] font-semibold mb-4">{data.bankAccountDisplay}</div>
          <div className="font-bold text-[13px] mb-2.5">Velocidade de liquidação</div>
          <div className="flex gap-2">
            <Button variant={data.settlementSpeed === 'd0' ? 'primary' : 'secondary'} className="flex-1" onClick={() => setSpeed('d0')}>
              D+0 (na hora)
            </Button>
            <Button variant={data.settlementSpeed === 'd1' ? 'primary' : 'secondary'} className="flex-1" onClick={() => setSpeed('d1')}>
              D+1 (custo menor)
            </Button>
          </div>
        </Card>
      </div>

      <div className="bg-white border border-border rounded-card overflow-hidden mb-4">
        <div className="px-5 py-4.5 font-bold text-[15px] border-b border-border">Extrato de liquidação</div>
        {data.extrato.map((e, i) => (
          <div key={i} className="grid gap-3 px-5 py-3.5 border-b border-hairline last:border-b-0 items-center text-[13.5px]" style={{ gridTemplateColumns: '1fr 1.6fr 0.9fr 0.9fr' }}>
            <div className="text-textSecondary font-mono-num text-[12.5px]">{e.data}</div>
            <div>{e.descricao}</div>
            <div className="font-mono-num font-bold" style={{ color: e.isPositive ? '#0A5C36' : '#0B1F3A' }}>
              {e.valorFmt}
            </div>
            <div className="font-mono-num text-textSecondary">{e.saldoFmt}</div>
          </div>
        ))}
      </div>

      <NavyCard className="p-6.5">
        <div className="font-bold text-[15px] mb-2.5">Como a Lastro monetiza</div>
        <div className="text-[#9FB3D6] text-[13.5px] leading-relaxed mb-4.5 max-w-[640px]">
          Cobramos uma taxa de plataforma de 0,35% sobre o valor de cada operação, descontada automaticamente na liquidação — sem mensalidade e sem taxa de adesão.
        </div>
        <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div className="rounded-[10px] p-4" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div className="text-[#9FB3D6] text-xs font-semibold">Valor da operação</div>
            <div className="text-[19px] font-extrabold mt-1.5">R$ 84.500</div>
          </div>
          <div className="rounded-[10px] p-4" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div className="text-[#9FB3D6] text-xs font-semibold">Taxa da plataforma (0,35%)</div>
            <div className="text-[19px] font-extrabold mt-1.5">R$ 295,75</div>
          </div>
          <div className="rounded-[10px] p-4" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div className="text-[#9FB3D6] text-xs font-semibold">Líquido repassado</div>
            <div className="text-[19px] font-extrabold mt-1.5 text-[#6FCF97]">R$ 84.204,25</div>
          </div>
        </div>
      </NavyCard>
    </div>
  );
}
