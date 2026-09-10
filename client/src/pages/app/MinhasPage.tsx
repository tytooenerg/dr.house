import { Fragment, useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { PageHeader } from '../../components/ui/Card';
import { ErrorState } from '../../components/ui/ErrorState';
import { SelfServiceAgentCard } from '../../components/agents/SelfServiceAgentCard';
import { useLang } from '../../lib/i18n';
import { Table, TableHead, TableBody, TableRow, TableCell } from '../../components/ui/Table';

interface LanceNaEscada {
  id: number;
  empresa: string;
  veiculo: string;
  taxaFmt: string;
  precoFmt: string;
  isMelhor: boolean;
}

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
  // Aprovada, mas travada esperando o sacado confirmar (lib/auctionOpen.ts recusa o leilão
  // sem aceite). O servidor sempre soube; a tela mostrava só "Aprovada" e a ausência do
  // botão, deixando o cedente sem saber o que estava faltando nem de quem dependia.
  aguardandoAceite: boolean;
  // Banda de mercado de hoje pro rating do sacado — sugestão, não imposição.
  reservaSugeridaAm: number;
  reservaTaxaAm: number | null;
  // O que a banda de hoje pagaria por esta duplicata. A taxa responde "quanto custa"; isto
  // responde a pergunta que o cedente faz de verdade, que é "quanto eu recebo".
  precoEstimadoFmt: string;
  // A disputa acontecendo agora. Era desenhada só no card do marketplace, para quem compete;
  // o dono da duplicata via apenas "No mercado" e esperava no escuro até o leilão fechar.
  leilao: {
    totalLances: number;
    melhorTaxaFmt: string | null;
    melhorPrecoFmt: string | null;
    fechaEm: string;
    fechaEmSec: number;
    lances: LanceNaEscada[];
  } | null;
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

  // Enquanto houver leilão aberto, a tela precisa acompanhar: um lance novo muda o que o
  // cedente recebe, e a página que só carrega uma vez mostra uma disputa congelada.
  const temLeilaoAberto = duplicatas.some((d) => d.leilao !== null);
  useEffect(() => {
    if (!temLeilaoAberto) return;
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [temLeilaoAberto]);

  // Qual disputa está expandida. A linha fica compacta por padrão — o resumo já responde
  // "estão brigando pela minha duplicata?"; a escada responde "quem, e a que preço".
  const [disputaAberta, setDisputaAberta] = useState<string | null>(null);

  // O leilão só abre depois que o cedente diz qual é o pior deságio que aceita. Antes disso
  // a plataforma escolhia esse piso por ele (banda de mercado em lib/dynamicPricing.ts), e o
  // cedente podia ver a duplicata vendida a uma taxa que nunca aprovou.
  const [reservaPara, setReservaPara] = useState<string | null>(null);
  const [taxaMaxima, setTaxaMaxima] = useState('');
  const [dispararErro, setDispararErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  const abrirReserva = (d: Duplicata) => {
    setDispararErro('');
    setReservaPara(d.id);
    setTaxaMaxima((d.reservaTaxaAm ?? d.reservaSugeridaAm).toFixed(2).replace('.', ','));
  };

  const disparar = async (id: string) => {
    setEnviando(true);
    setDispararErro('');
    try {
      const data = await api.post<{ duplicatas: Duplicata[] }>(`/minhas/${id}/leilao`, { taxaMaxima });
      setDuplicatas(data.duplicatas);
      setReservaPara(null);
    } catch (err) {
      setDispararErro(err instanceof ApiError ? err.message : 'Não foi possível abrir o leilão.');
    } finally {
      setEnviando(false);
    }
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
          <Fragment key={d.id}>
          <TableRow columns={COLS}>
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
              {d.aguardandoAceite && (
                <span className="text-[11.5px] font-semibold text-amber">Aguardando o aceite do sacado para poder leiloar</span>
              )}
              {d.canDisparar && reservaPara !== d.id && (
                <button type="button" onClick={() => abrirReserva(d)} className="px-2.5 py-1.5 rounded-md border-none bg-blue text-white text-[11.5px] font-bold cursor-pointer">
                  {t('minhas.disparar', 'Disparar leilão')}
                </button>
              )}
              {d.canDisparar && reservaPara === d.id && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <label className="text-[11.5px] font-bold text-textSecondary" htmlFor={`reserva-${d.id}`}>
                    Aceito até
                  </label>
                  <input
                    id={`reserva-${d.id}`}
                    value={taxaMaxima}
                    onChange={(e) => setTaxaMaxima(e.target.value)}
                    className="w-[68px] px-2 py-1 rounded-md border border-inputBorder text-[12.5px] font-mono-num"
                  />
                  <span className="text-[11.5px] text-textSecondary">% a.m.</span>
                  <button
                    type="button"
                    disabled={enviando}
                    onClick={() => disparar(d.id)}
                    className="px-2.5 py-1.5 rounded-md border-none bg-blue text-white text-[11.5px] font-bold cursor-pointer disabled:bg-onNavyDim"
                  >
                    {enviando ? 'Abrindo…' : 'Abrir leilão'}
                  </button>
                  <button type="button" onClick={() => setReservaPara(null)} className="bg-transparent border-none text-textTertiary text-[11.5px] font-bold cursor-pointer underline">
                    Cancelar
                  </button>
                  <span className="text-[11.5px] text-textTertiary w-full">
                    Mercado hoje para este sacado: ~{d.reservaSugeridaAm.toFixed(2).replace('.', ',')}% a.m. — nessa taxa você receberia{' '}
                    <b className="font-mono-num text-textSecondary">{d.precoEstimadoFmt}</b>. Lance com deságio pior que o seu limite é recusado.
                  </span>
                  {dispararErro && <span className="text-[11.5px] font-semibold text-red w-full">{dispararErro}</span>}
                </div>
              )}
            </TableCell>
          </TableRow>
          {/* Faixa de largura inteira, e não uma célula: a disputa é o produto, e espremê-la na
              coluna de status quebrava nome de financiador no meio. */}
          {d.leilao && (
            <TableRow columns="1fr" className="!py-3 bg-surface">
              <TableCell>
            <div className="flex items-center gap-2 flex-wrap w-full">
              {d.leilao.totalLances === 0 ? (
                <span className="text-[11.5px] text-textSecondary">
                  Nenhum lance ainda · fecha em <b className="font-mono-num">{d.leilao.fechaEm}</b>
                </span>
              ) : (
                <>
                  <span className="text-[11.5px] text-textSecondary">
                    <b className="text-textPrimary">
                      {d.leilao.totalLances} {d.leilao.totalLances === 1 ? 'financiador' : 'financiadores'}
                    </b>{' '}
                    disputando · melhor <b className="font-mono-num text-green">{d.leilao.melhorTaxaFmt}</b> a.m. ={' '}
                    <b className="font-mono-num text-green">{d.leilao.melhorPrecoFmt}</b> · fecha em{' '}
                    <b className="font-mono-num">{d.leilao.fechaEm}</b>
                  </span>
                  <button
                    type="button"
                    aria-label={disputaAberta === d.id ? `Ocultar a disputa de ${d.sacado}` : `Ver a disputa de ${d.sacado}`}
                    onClick={() => setDisputaAberta(disputaAberta === d.id ? null : d.id)}
                    className="bg-transparent border-none text-blue text-[11.5px] font-bold cursor-pointer underline p-0"
                  >
                    {disputaAberta === d.id ? 'Ocultar' : 'Ver a disputa'}
                  </button>
                </>
              )}
              {disputaAberta === d.id && (
                <ul className="w-full flex flex-col gap-1 mt-1 list-none p-0">
                  {d.leilao.lances.map((l) => (
                    <li key={l.id} className="flex items-baseline justify-between gap-3 text-[12px] border-b border-hairline last:border-b-0 pb-1">
                      <span>
                        {l.empresa}
                        {/* O regime sob o qual o crédito seria adquirido muda o que a cessão é;
                            quem está vendendo tem direito de saber antes do leilão fechar. */}
                        <span className="text-textTertiary"> · {l.veiculo}</span>
                      </span>
                      <span className="font-mono-num whitespace-nowrap" style={{ color: l.isMelhor ? '#0A5C36' : undefined }}>
                        {l.taxaFmt} a.m. · <b>{l.precoFmt}</b>
                        {l.isMelhor && <span className="font-sans font-bold text-[11px]"> · melhor</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
              </TableCell>
            </TableRow>
          )}
          </Fragment>
        ))}
        </TableBody>
      </Table>
      )}
    </div>
  );
}
