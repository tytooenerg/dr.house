import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { Logo } from '../../components/Logo';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Input';
import { Notice } from '../../components/ui/Notice';

// Onde o sacado chega pelo link de aceite (server/src/lib/aceiteConvite.ts): confere a
// duplicata e confirma ou contesta, sem criar conta. Quem responde se identifica (CNPJ da
// empresa, nome e cargo) — a resposta fica registrada com data, hora e origem.

interface Resumo {
  duplicataId: string;
  emitente: string;
  sacado: string;
  valorFmt: string;
  emissao: string;
  vencimento: string;
  nfeChave: string | null;
  registro: string | null;
  prazoAte: string;
  cnpjConhecido: boolean;
}

export function AceiteLinkPage() {
  const { token = '' } = useParams();
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [erroCarregar, setErroCarregar] = useState('');
  const [decisao, setDecisao] = useState<'aceita' | 'contestada' | null>(null);
  const [cnpj, setCnpj] = useState('');
  const [nome, setNome] = useState('');
  const [cargo, setCargo] = useState('');
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [respondido, setRespondido] = useState<'aceita' | 'contestada' | null>(null);

  useEffect(() => {
    api
      .get<Resumo>(`/public/aceite/${encodeURIComponent(token)}`)
      .then(setResumo)
      .catch((err) => setErroCarregar(err instanceof ApiError ? err.message : 'Não foi possível abrir este link.'));
  }, [token]);

  const enviar = async () => {
    if (!decisao) return;
    setEnviando(true);
    setErro('');
    try {
      await api.post(`/public/aceite/${encodeURIComponent(token)}`, { decisao, cnpj, nome, cargo, motivo });
      setRespondido(decisao);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Não foi possível registrar sua resposta — tente de novo.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="w-full min-h-screen flex items-start sm:items-center justify-center bg-bg px-4 py-8">
      <div className="w-full max-w-[520px] bg-white border border-border rounded-2xl p-6 sm:p-8">
        <div className="mb-5">
          <Logo />
        </div>

        {erroCarregar && (
          <div className="text-center">
            <div className="text-lg font-extrabold mb-2">Link indisponível</div>
            <div className="text-textSecondary text-[13.5px]">{erroCarregar}</div>
          </div>
        )}

        {!erroCarregar && !resumo && <div className="text-textSecondary text-[13.5px]">Carregando a duplicata…</div>}

        {respondido && (
          <div className="text-center" data-testid="aceite-respondido">
            <div className="text-lg font-extrabold mb-2">{respondido === 'aceita' ? 'Duplicata confirmada' : 'Contestação registrada'}</div>
            <div className="text-textSecondary text-[13.5px]">
              {respondido === 'aceita'
                ? `Obrigado. ${resumo?.emitente} já foi avisado da sua confirmação.`
                : `${resumo?.emitente} foi avisado e vai entrar em contato para resolver.`}
            </div>
          </div>
        )}

        {resumo && !respondido && (
          <>
            <div className="text-lg font-extrabold mb-1">Confirme esta duplicata</div>
            <div className="text-textSecondary text-[13.5px] mb-4">
              <b>{resumo.emitente}</b> emitiu uma duplicata contra <b>{resumo.sacado}</b>. Confira os dados e responda até <b>{resumo.prazoAte}</b>.
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 bg-surface rounded-xl px-4 py-3.5 mb-5 text-[13px]">
              <div>
                <dt className="text-textTertiary text-[11.5px]">Valor</dt>
                <dd className="m-0 font-mono-num font-extrabold text-[15px]">{resumo.valorFmt}</dd>
              </div>
              <div>
                <dt className="text-textTertiary text-[11.5px]">Vencimento</dt>
                <dd className="m-0 font-semibold">{resumo.vencimento}</dd>
              </div>
              <div>
                <dt className="text-textTertiary text-[11.5px]">Emissão</dt>
                <dd className="m-0">{resumo.emissao}</dd>
              </div>
              <div>
                <dt className="text-textTertiary text-[11.5px]">Duplicata</dt>
                <dd className="m-0 font-mono-num">{resumo.duplicataId}</dd>
              </div>
              {resumo.nfeChave && (
                <div className="col-span-2">
                  <dt className="text-textTertiary text-[11.5px]">Nota fiscal</dt>
                  <dd className="m-0 font-mono-num text-[11.5px] break-all">{resumo.nfeChave}</dd>
                </div>
              )}
            </dl>

            <div className="grid grid-cols-2 gap-2.5 mb-4">
              <button
                type="button"
                onClick={() => setDecisao('aceita')}
                className={`px-3 py-3 rounded-lg font-bold text-[14px] cursor-pointer border-2 ${decisao === 'aceita' ? 'bg-green text-white border-green' : 'bg-white text-green border-greenBorder'}`}
              >
                Confirmo
              </button>
              <button
                type="button"
                onClick={() => setDecisao('contestada')}
                className={`px-3 py-3 rounded-lg font-bold text-[14px] cursor-pointer border-2 ${decisao === 'contestada' ? 'bg-red text-white border-red' : 'bg-white text-red border-redBorder'}`}
              >
                Contesto
              </button>
            </div>

            {decisao && (
              <div className="flex flex-col gap-3">
                <Field label={resumo.cnpjConhecido ? 'CNPJ da sua empresa (para confirmar que é você)' : 'CNPJ da sua empresa'}>
                  <Input value={cnpj} onChange={(e) => setCnpj(e.target.value)} placeholder="00.000.000/0000-00" inputMode="numeric" />
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Seu nome">
                    <Input value={nome} onChange={(e) => setNome(e.target.value)} />
                  </Field>
                  <Field label="Seu cargo">
                    <Input value={cargo} onChange={(e) => setCargo(e.target.value)} placeholder="ex.: Financeiro" />
                  </Field>
                </div>
                {decisao === 'contestada' && (
                  <Field label="O que está errado?">
                    <textarea
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                      rows={3}
                      className="w-full px-3 py-2 rounded-lg border border-inputBorder text-[14px]"
                      placeholder="ex.: a mercadoria não foi entregue, o valor está diferente…"
                    />
                  </Field>
                )}
                {erro && <Notice variant="danger">{erro}</Notice>}
                <Button onClick={enviar} disabled={enviando}>
                  {enviando ? 'Enviando…' : decisao === 'aceita' ? 'Confirmar a duplicata' : 'Enviar contestação'}
                </Button>
                <div className="text-[11.5px] text-textTertiary">
                  Sua resposta fica registrada com data, hora e origem do acesso, e vale como manifestação da sua empresa sobre esta duplicata.
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
