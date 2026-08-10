import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/ui/Card';
import { useLang } from '../../lib/i18n';

interface Duplicata {
  id: string;
  sacado: string;
  valorFmt: string;
  emissao: string;
  vencimento: string;
  lastroFmt: string;
  lastroColor: string;
  status: string;
  statusBg: string;
  statusColor: string;
  canDisparar: boolean;
}

const COLS = '1.2fr 0.8fr 0.7fr 0.7fr 0.7fr 1.2fr';

export function MinhasPage() {
  const { t } = useLang();
  const [duplicatas, setDuplicatas] = useState<Duplicata[]>([]);

  const load = () => api.get<{ duplicatas: Duplicata[] }>('/minhas').then((d) => setDuplicatas(d.duplicatas));

  useEffect(() => {
    load();
  }, []);

  const disparar = async (id: string) => {
    const data = await api.post<{ duplicatas: Duplicata[] }>(`/minhas/${id}/leilao`);
    setDuplicatas(data.duplicatas);
  };

  return (
    <div>
      <PageHeader title={t('minhas.title', 'Minhas Duplicatas')} subtitle={t('minhas.subtitle', 'Cadastre e acompanhe suas duplicatas enviadas ao mercado')} />

      <div className="border-2 border-dashed border-[#C7D0DE] rounded-card p-9 text-center bg-white mb-6">
        <div className="w-11 h-11 rounded-[10px] border-2 border-blue mx-auto mb-3.5 flex items-center justify-center relative">
          <div className="w-4 h-0.5 bg-blue absolute" />
          <div className="w-0.5 h-4 bg-blue absolute" />
        </div>
        <div className="font-bold text-[15px]">{t('minhas.dropzoneTitle', 'Arraste um XML ou PDF de NF-e / duplicata')}</div>
        <div className="text-textSecondary text-[13px] mt-1.5">{t('minhas.dropzoneHint', 'ou clique para selecionar um arquivo do seu computador')}</div>
      </div>

      <div className="bg-white border border-border rounded-card overflow-hidden">
        <div className="grid gap-3 px-5 py-3.5 bg-[#F7F8FA] border-b border-border text-xs font-bold text-textSecondary uppercase tracking-wide" style={{ gridTemplateColumns: COLS }}>
          <div>{t('minhas.colSacado', 'Sacado')}</div>
          <div>{t('minhas.colValor', 'Valor')}</div>
          <div>{t('minhas.colEmissao', 'Emissão')}</div>
          <div>{t('minhas.colVencimento', 'Vencimento')}</div>
          <div>{t('minhas.colLastro', 'Lastro')}</div>
          <div>{t('minhas.colStatus', 'Status / Ação')}</div>
        </div>
        {duplicatas.map((d) => (
          <div key={d.id} className="grid gap-3 px-5 py-4 border-b border-border last:border-b-0 items-center text-sm" style={{ gridTemplateColumns: COLS }}>
            <div className="font-semibold">{d.sacado}</div>
            <div className="font-mono-num font-bold">{d.valorFmt}</div>
            <div className="text-textSecondary">{d.emissao}</div>
            <div className="text-textSecondary">{d.vencimento}</div>
            <div className="font-bold text-[13px]" style={{ color: d.lastroColor }}>
              {d.lastroFmt}
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block text-[11.5px] font-bold px-2.5 py-1 rounded-md" style={{ background: d.statusBg, color: d.statusColor }}>
                {d.status}
              </span>
              {d.canDisparar && (
                <button type="button" onClick={() => disparar(d.id)} className="px-2.5 py-1.5 rounded-md border-none bg-blue text-white text-[11px] font-bold cursor-pointer">
                  {t('minhas.disparar', 'Disparar leilão')}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
