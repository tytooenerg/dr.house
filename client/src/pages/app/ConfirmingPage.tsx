import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { PageHeader, Card } from '../../components/ui/Card';
import { Field, Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';

interface MembroView {
  id: number;
  cedenteNome: string;
  cedenteEmail: string;
  sublimiteFmt: string | null;
  status: 'ativo' | 'removido';
}

interface ProgramaView {
  id: number;
  sacadoCnpj: string;
  rating: string;
  taxaAmFmt: string;
  limiteFmt: string;
  utilizadoFmt: string;
  disponivelFmt: string;
  status: 'ativo' | 'pausado';
  membros: MembroView[];
}

interface CedenteElegivel {
  cedenteUserId: number;
  cedenteNome: string;
  volumeHistoricoFmt: string;
  jaMatriculado: boolean;
}

// Programa Confirming / Risco Sacado — o sacado pré-aprova um programa de financiamento
// pra sua cadeia de fornecedores, na taxa da própria classificação de risco. Esta é a
// fundação: criar/pausar o programa e matricular cedentes com histórico real de aceite
// contra este sacado (listarCedentesElegiveis, server-side). O financiamento automático
// em si — pular o leilão na emissão — vem numa feature seguinte.
export function ConfirmingPage() {
  const [programa, setPrograma] = useState<ProgramaView | null>(null);
  const [cnpj, setCnpj] = useState('');
  const [limite, setLimite] = useState('');
  const [elegiveis, setElegiveis] = useState<CedenteElegivel[]>([]);
  const [sublimiteById, setSublimiteById] = useState<Record<number, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = () =>
    api.get<{ programa: ProgramaView | null; cnpjAtual: string }>('/confirming/meu-programa').then((d) => {
      setPrograma(d.programa);
      setCnpj((c) => c || d.cnpjAtual);
    });

  const loadElegiveis = () => api.get<{ elegiveis: CedenteElegivel[] }>('/confirming/elegiveis').then((d) => setElegiveis(d.elegiveis));

  useEffect(() => {
    load();
    loadElegiveis();
  }, []);

  const run = async (key: string, fn: () => Promise<void>, fallbackMessage: string) => {
    if (busyKey) return;
    setError('');
    setNotice('');
    setBusyKey(key);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fallbackMessage);
    } finally {
      setBusyKey(null);
    }
  };

  const criar = () =>
    run(
      'criar',
      async () => {
        const p = await api.post<ProgramaView>('/confirming/criar', { cnpj, limite });
        setPrograma(p);
        setNotice('Programa criado — a taxa foi calculada a partir da sua própria classificação de risco.');
        await loadElegiveis();
      },
      'Não foi possível criar o programa.'
    );

  const pausar = () =>
    run(
      'pausar',
      async () => {
        setPrograma(await api.post<ProgramaView>('/confirming/pausar'));
      },
      'Não foi possível pausar o programa.'
    );

  const reativar = () =>
    run(
      'reativar',
      async () => {
        setPrograma(await api.post<ProgramaView>('/confirming/reativar'));
      },
      'Não foi possível reativar o programa.'
    );

  const matricular = (cedenteUserId: number) =>
    run(
      `matricular:${cedenteUserId}`,
      async () => {
        const p = await api.post<ProgramaView>('/confirming/membros', { cedenteUserId, sublimite: sublimiteById[cedenteUserId] || null });
        setPrograma(p);
        await loadElegiveis();
      },
      'Não foi possível matricular este cedente.'
    );

  const remover = (membroId: number) =>
    run(
      `remover:${membroId}`,
      async () => {
        const p = await api.post<ProgramaView>(`/confirming/membros/${membroId}/remover`);
        setPrograma(p);
        await loadElegiveis();
      },
      'Não foi possível remover este cedente.'
    );

  return (
    <div>
      <PageHeader title="Programa Confirming" subtitle="Pré-aprove financiamento para a sua cadeia de fornecedores, na sua própria taxa de risco" />

      {error && <div className="mb-4 px-3.5 py-3 rounded-lg bg-redBg text-red text-sm font-semibold">{error}</div>}
      {notice && <div className="mb-4 px-3.5 py-3 rounded-lg bg-greenBg text-green text-sm font-semibold">{notice}</div>}

      {!programa ? (
        <Card className="mb-4 max-w-[560px]">
          <div className="font-bold text-[15px] mb-1">Criar meu Programa Confirming</div>
          <div className="text-textSecondary text-[12.5px] mb-4">
            A taxa é calculada a partir da classificação de risco real da sua empresa (mesma banda que já se aplicaria a você no mercado
            aberto) — você define apenas o limite total do programa.
          </div>
          <div className="flex flex-col gap-3.5">
            <Field label="CNPJ da sua empresa">
              <Input placeholder="00.000.000/0001-00" value={cnpj} onChange={(e) => setCnpj(e.target.value)} />
            </Field>
            <Field label="Limite total do programa (R$)">
              <Input mono placeholder="500.000" value={limite} onChange={(e) => setLimite(e.target.value)} />
            </Field>
            <Button onClick={criar} disabled={busyKey === 'criar'}>
              {busyKey === 'criar' ? 'Criando…' : 'Criar programa'}
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <Card className="mb-4">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-1">
              <div className="font-bold text-[15px]">Meu programa — rating {programa.rating}</div>
              <span
                className="text-[11.5px] font-bold px-2.5 py-1 rounded-md"
                style={programa.status === 'ativo' ? { background: '#EAF3EE', color: '#0A5C36' } : { background: '#F0F2F5', color: '#5B6472' }}
              >
                {programa.status === 'ativo' ? 'Ativo' : 'Pausado'}
              </span>
            </div>
            <div className="grid gap-4 mt-3.5" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
              <div>
                <div className="text-textSecondary text-xs font-semibold">Taxa</div>
                <div className="text-lg font-extrabold font-mono-num mt-0.5">{programa.taxaAmFmt}</div>
              </div>
              <div>
                <div className="text-textSecondary text-xs font-semibold">Limite</div>
                <div className="text-lg font-extrabold font-mono-num mt-0.5">{programa.limiteFmt}</div>
              </div>
              <div>
                <div className="text-textSecondary text-xs font-semibold">Utilizado</div>
                <div className="text-lg font-extrabold font-mono-num mt-0.5">{programa.utilizadoFmt}</div>
              </div>
              <div>
                <div className="text-textSecondary text-xs font-semibold">Disponível</div>
                <div className="text-lg font-extrabold font-mono-num mt-0.5 text-green">{programa.disponivelFmt}</div>
              </div>
            </div>
            <div className="mt-4">
              {programa.status === 'ativo' ? (
                <Button variant="secondary" size="sm" onClick={pausar} disabled={busyKey === 'pausar'}>
                  {busyKey === 'pausar' ? 'Pausando…' : 'Pausar programa'}
                </Button>
              ) : (
                <Button size="sm" onClick={reativar} disabled={busyKey === 'reativar'}>
                  {busyKey === 'reativar' ? 'Reativando…' : 'Reativar programa'}
                </Button>
              )}
            </div>
          </Card>

          <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Card>
              <div className="font-bold text-[14.5px] mb-1">Fornecedores matriculados</div>
              <div className="text-textSecondary text-[12.5px] mb-3.5">Cedentes que já podem ser financiados dentro do seu programa</div>
              {programa.membros.filter((m) => m.status === 'ativo').length === 0 ? (
                <div className="text-textSecondary text-[12.5px]">Nenhum fornecedor matriculado ainda.</div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {programa.membros
                    .filter((m) => m.status === 'ativo')
                    .map((m) => (
                      <div key={m.id} className="flex items-center justify-between gap-2 p-3 rounded-[10px] bg-bg">
                        <div>
                          <div className="font-semibold text-[13px]">{m.cedenteNome}</div>
                          <div className="text-textSecondary text-[11.5px]">{m.cedenteEmail}{m.sublimiteFmt ? ` · sublimite ${m.sublimiteFmt}` : ''}</div>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => remover(m.id)} disabled={busyKey === `remover:${m.id}`}>
                          {busyKey === `remover:${m.id}` ? 'Removendo…' : 'Remover'}
                        </Button>
                      </div>
                    ))}
                </div>
              )}
            </Card>

            <Card>
              <div className="font-bold text-[14.5px] mb-1">Fornecedores elegíveis</div>
              <div className="text-textSecondary text-[12.5px] mb-3.5">Cedentes com histórico real de duplicatas contra sua empresa</div>
              {elegiveis.length === 0 ? (
                <div className="text-textSecondary text-[12.5px]">Nenhum cedente com histórico contra sua empresa ainda.</div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {elegiveis.map((c) => (
                    <div key={c.cedenteUserId} className="flex items-center justify-between gap-2 p-3 rounded-[10px] bg-bg">
                      <div>
                        <div className="font-semibold text-[13px]">{c.cedenteNome}</div>
                        <div className="text-textSecondary text-[11.5px]">Histórico: {c.volumeHistoricoFmt}</div>
                      </div>
                      {c.jaMatriculado ? (
                        <span className="text-[11.5px] font-bold text-green">Matriculado</span>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <input
                            placeholder="Sublimite (opcional)"
                            value={sublimiteById[c.cedenteUserId] ?? ''}
                            onChange={(e) => setSublimiteById((s) => ({ ...s, [c.cedenteUserId]: e.target.value }))}
                            className="w-[130px] px-2.5 py-1.5 rounded-md border border-inputBorder text-[12px] outline-none"
                          />
                          <Button size="sm" onClick={() => matricular(c.cedenteUserId)} disabled={busyKey === `matricular:${c.cedenteUserId}`}>
                            {busyKey === `matricular:${c.cedenteUserId}` ? 'Matriculando…' : 'Matricular'}
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
