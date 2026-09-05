import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { PageHeader } from '../../components/ui/Card';
import { ErrorState } from '../../components/ui/ErrorState';
import { SelfServiceAgentCard } from '../../components/agents/SelfServiceAgentCard';
import { useLang } from '../../lib/i18n';
import { Table, TableHead, TableBody, TableRow, TableCell } from '../../components/ui/Table';

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
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = () => {
    setLoadError(null);
    return api
      .get<{ duplicatas: Duplicata[] }>('/minhas')
      .then((d) => setDuplicatas(d.duplicatas))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Falha ao carregar suas duplicatas.'));
  };

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

      <div className="mb-6">
        <SelfServiceAgentCard
          agentId="suporte"
          title="Pergunte à IA sobre uma duplicata ou aceite"
          placeholder="Ex: qual o status do aceite da duplicata dup_9f2a? Pode reenviar o lembrete pro sacado?"
        />
      </div>

      <div className="border-2 border-dashed border-borderStrong rounded-card p-9 text-center bg-white mb-6">
        <div className="w-11 h-11 rounded-[10px] border-2 border-blue mx-auto mb-3.5 flex items-center justify-center relative">
          <div className="w-4 h-0.5 bg-blue absolute" />
          <div className="w-0.5 h-4 bg-blue absolute" />
        </div>
        <div className="font-bold text-[15px]">{t('minhas.dropzoneTitle', 'Arraste um XML ou PDF de NF-e / duplicata')}</div>
        <div className="text-textSecondary text-[13px] mt-1.5">{t('minhas.dropzoneHint', 'ou clique para selecionar um arquivo do seu computador')}</div>
      </div>

      {loadError && <ErrorState message={loadError} onRetry={load} />}

      {!loadError && (
      <Table label={t('minhas.title', 'Minhas Duplicatas')}>
        <TableHead
          columns={COLS}
          labels={[
            t('minhas.colSacado', 'Sacado'),
            t('minhas.colValor', 'Valor'),
            t('minhas.colEmissao', 'Emissão'),
            t('minhas.colVencimento', 'Vencimento'),
            t('minhas.colLastro', 'Lastro'),
            t('minhas.colStatus', 'Status / Ação'),
          ]}
        />
        <TableBody>
        {duplicatas.map((d) => (
          <TableRow key={d.id} columns={COLS}>
            <TableCell className="font-semibold">{d.sacado}</TableCell>
            <TableCell className="font-mono-num font-bold">{d.valorFmt}</TableCell>
            <TableCell className="text-textSecondary">{d.emissao}</TableCell>
            <TableCell className="text-textSecondary">{d.vencimento}</TableCell>
            <TableCell className="font-bold text-[13px]">
              <span style={{ color: d.lastroColor }}>{d.lastroFmt}</span>
            </TableCell>
            <TableCell className="flex items-center gap-2">
              <span className="inline-block text-[11.5px] font-bold px-2.5 py-1 rounded-md" style={{ background: d.statusBg, color: d.statusColor }}>
                {d.status}
              </span>
              {d.canDisparar && (
                <button type="button" onClick={() => disparar(d.id)} className="px-2.5 py-1.5 rounded-md border-none bg-blue text-white text-[11.5px] font-bold cursor-pointer">
                  {t('minhas.disparar', 'Disparar leilão')}
                </button>
              )}
            </TableCell>
          </TableRow>
        ))}
        </TableBody>
      </Table>
      )}
    </div>
  );
}
