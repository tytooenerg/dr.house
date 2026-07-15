import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { PageHeader, Card, NavyCard } from '../../components/ui/Card';
import { Toggle } from '../../components/ui/Toggle';

interface Connector {
  key: string;
  name: string;
  desc: string;
  connected: boolean;
}
interface ErpData {
  connectors: Connector[];
  whitelabelOn: boolean;
}

export function ErpPage() {
  const [data, setData] = useState<ErpData | null>(null);

  useEffect(() => {
    api.get<ErpData>('/erp').then(setData);
  }, []);

  if (!data) return null;

  const toggleConnector = (key: string) => api.post<ErpData>(`/erp/${key}/toggle`).then(setData);

  return (
    <div>
      <PageHeader title="Integrações ERP" subtitle="Conecte seu sistema de gestão — suas vendas viram duplicatas escriturais automaticamente, sem digitação manual" />

      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {data.connectors.map((c) => (
          <Card key={c.key}>
            <div className="w-11 h-11 rounded-[10px] bg-bg flex items-center justify-center font-extrabold text-[15px] text-navy mb-4">{c.name}</div>
            <div className="font-bold text-[15.5px] mb-2">{c.name}</div>
            <div className="text-textSecondary text-[13px] leading-snug mb-4.5 min-h-14">{c.desc}</div>
            <button
              type="button"
              onClick={() => toggleConnector(c.key)}
              className="w-full py-2.5 rounded-lg border-none text-[13px] font-bold cursor-pointer"
              style={{ background: c.connected ? '#EAF3EE' : '#1E5EFF', color: c.connected ? '#0A5C36' : '#fff' }}
            >
              {c.connected ? 'Conectado ✓' : 'Conectar'}
            </button>
          </Card>
        ))}
      </div>

      <NavyCard className="flex items-center justify-between gap-4 flex-wrap mb-4">
        <div>
          <div className="font-bold text-[15px] mb-1.5">Programa white-label para sacados grandes</div>
          <div className="text-[#9FB3D6] text-[13.5px] leading-relaxed max-w-[600px]">
            Ofereça antecipação de recebíveis aos seus próprios fornecedores com sua marca, cores e URL — a Lastro cuida da infraestrutura por trás.
          </div>
        </div>
        <Toggle on={data.whitelabelOn} onClick={() => toggleConnector('whitelabel')} size="lg" />
      </NavyCard>

      <Card>
        <div className="font-bold text-[15px] mb-3.5">Por que integrar direto do ERP</div>
        <div className="flex flex-col gap-2.5">
          {[
            'Elimina digitação manual e risco de erro humano no cadastro da duplicata',
            'Você mantém o "botão de comando" — opt-in e decisão de antecipar continuam com seu financeiro',
            'Aprovação em minutos, dinheiro na conta em até 24h após o leilão fechar',
          ].map((t) => (
            <div key={t} className="flex items-center gap-2.5 text-[13.5px]">
              <span className="rounded-full bg-blue flex-shrink-0" style={{ width: 6, height: 6 }} />
              {t}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
