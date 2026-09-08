import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { PageHeader, Card, NavyCard } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { PageSkeleton } from '../../components/ui/Skeleton';
import { PALETTE } from '../../lib/palette';
import { Badge } from '../../components/ui/Badge';
import { Notice } from '../../components/ui/Notice';
import { Field } from '../../components/ui/Input';
import { Table, TableHead, TableBody, TableRow, TableCell } from '../../components/ui/Table';
import { useApi } from '../../lib/useApi';

interface Apolice {
  id: string;
  cedente: string;
  sacado: string;
  valorFmt: string;
  vencimento: string;
  premioFmt: string;
  status: string;
  sinistroStatus: string;
}
interface Sinistro {
  id: string;
  cedente: string;
  sacado: string;
  valorFmt: string;
  vencimento: string;
}
interface ExposicaoPorSacado {
  chave: string;
  sacado: string;
  valorFmt: string;
  valor: number;
  apolices: number;
}
interface Exposicao {
  totalFmt: string;
  apolices: number;
  limiteTotal: number | null;
  limiteTotalFmt: string | null;
  limitePorSacado: number | null;
  limitePorSacadoFmt: string | null;
  usoTotalPct: number | null;
  porSacado: ExposicaoPorSacado[];
}
interface SeguradoraData {
  insurerName: string;
  premioPctFmt: string;
  totalApolices: number;
  totalSeguradoFmt: string;
  totalPremioFmt: string;
  exposicao: Exposicao | null;
  apolices: Apolice[];
  sinistros: Sinistro[];
}

export function SeguradoraPage() {
  const [noteById, setNoteById] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [aiById, setAiById] = useState<Record<string, { assessment: string; reasoning: string } | null>>({});
  const [loadingAiId, setLoadingAiId] = useState<string | null>(null);

  const { data, error: loadError, reload: load, setData } = useApi<SeguradoraData>('/seguradora', { fallbackMessage: 'Falha ao carregar o painel da seguradora.' });
  const [limiteTotal, setLimiteTotal] = useState('');
  const [limitePorSacado, setLimitePorSacado] = useState('');
  const [salvandoLimites, setSalvandoLimites] = useState(false);
  const [erroLimites, setErroLimites] = useState<string | null>(null);

  // Campo vazio = "sem limite declarado" (null no servidor), que é diferente de zero: sem
  // declaração a plataforma não impõe teto nenhum.
  const parseLimite = (v: string): number | null => {
    const limpo = v.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
    if (!limpo.trim()) return null;
    const n = parseFloat(limpo);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const salvarLimites = async () => {
    setSalvandoLimites(true);
    setErroLimites(null);
    try {
      const atualizado = await api.put<SeguradoraData>('/seguradora/limites', {
        limiteTotal: parseLimite(limiteTotal),
        limitePorSacado: parseLimite(limitePorSacado),
      });
      setData(atualizado);
    } catch (err) {
      setErroLimites(err instanceof ApiError ? err.message : 'Não foi possível salvar a capacidade declarada.');
    } finally {
      setSalvandoLimites(false);
    }
  };

  const decide = async (id: string, decision: 'aprovado' | 'negado') => {
    const note = noteById[id]?.trim();
    if (!note) return;
    setBusyId(id);
    try {
      const updated = await api.post<SeguradoraData>(`/seguradora/sinistro/${id}/decidir`, { decision, note });
      setData(updated);
    } finally {
      setBusyId(null);
    }
  };

  const generateAiTriagem = async (id: string) => {
    setLoadingAiId(id);
    try {
      const res = await api.get<{ assessment: { assessment: string; reasoning: string } | null }>(`/seguradora/sinistro/${id}/ai-triagem`);
      setAiById((prev) => ({ ...prev, [id]: res.assessment }));
    } finally {
      setLoadingAiId(null);
    }
  };

  if (loadError) return <ErrorState message={loadError} onRetry={load} />;
  if (!data) return <PageSkeleton />;

  return (
    <div>
      <PageHeader title="Painel da Seguradora" subtitle={`${data.insurerName} — apólices e sinistros sobre duplicatas seguradas na Lastro`} />

      <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <NavyCard>
          <div className="text-textTertiary text-[13px] font-semibold">Apólices ativas</div>
          <div className="text-2xl font-extrabold mt-2.5">{data.totalApolices}</div>
        </NavyCard>
        <Card>
          <div className="text-textSecondary text-[13px] font-semibold">Valor total segurado</div>
          <div className="text-2xl font-extrabold mt-2.5">{data.totalSeguradoFmt}</div>
        </Card>
        <Card>
          {/* O rótulo trazia o percentual fixo do catálogo, como se toda apólice tivesse sido
              cobrada à mesma taxa. Não é: cada duplicata é precificada pelo próprio risco
              (lib/insuranceQuotes.ts), então o único número honesto aqui é a soma do que foi
              de fato cobrado — e o percentual único sai. */}
          <div className="text-textSecondary text-[13px] font-semibold">Prêmio acumulado</div>
          <div className="text-2xl font-extrabold mt-2.5 text-green">{data.totalPremioFmt}</div>
          <div className="text-textTertiary text-[12px] mt-1">Soma do que foi realmente cobrado, apólice a apólice</div>
        </Card>
      </div>

      {data.exposicao && (
        <Card className="mb-6">
          <div className="font-bold text-[15px]">Capacidade e concentração</div>
          <div className="text-textSecondary text-[12.5px] mt-1 mb-4">
            Exposição viva: o risco distribuído pela Lastro que ainda pode virar sinistro — apólices já vendidas
            ou pagas saem da conta. Os limites abaixo são <strong>declarados por você</strong>; a Lastro só passa a
            recusar contratações depois que você informa um teto.
          </div>

          <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <Card>
              <div className="text-textSecondary text-[13px] font-semibold">Exposição em risco</div>
              <div className="text-2xl font-extrabold mt-2.5">{data.exposicao.totalFmt}</div>
              <div className="text-textSecondary text-[12.5px] mt-1">{data.exposicao.apolices} apólice(s)</div>
            </Card>
            <Card>
              <div className="text-textSecondary text-[13px] font-semibold">Limite total declarado</div>
              <div className="text-2xl font-extrabold mt-2.5">{data.exposicao.limiteTotalFmt ?? '—'}</div>
              <div className="text-textSecondary text-[12.5px] mt-1">
                {data.exposicao.usoTotalPct === null ? 'Sem limite declarado' : `${data.exposicao.usoTotalPct}% utilizado`}
              </div>
            </Card>
            <Card>
              <div className="text-textSecondary text-[13px] font-semibold">Limite por sacado</div>
              <div className="text-2xl font-extrabold mt-2.5">{data.exposicao.limitePorSacadoFmt ?? '—'}</div>
              <div className="text-textSecondary text-[12.5px] mt-1">
                {data.exposicao.limitePorSacado === null ? 'Sem limite declarado' : 'Teto de concentração'}
              </div>
            </Card>
          </div>

          <div className="flex items-end gap-3 flex-wrap mb-2">
            <div className="flex-1 min-w-[180px]">
              <Field label="Limite total (R$)">
                <input
                  className="w-full px-3 py-2 rounded-md border border-inputBorder text-[13px]"
                  placeholder={data.exposicao.limiteTotalFmt ?? 'sem limite'}
                  value={limiteTotal}
                  onChange={(e) => setLimiteTotal(e.target.value)}
                />
              </Field>
            </div>
            <div className="flex-1 min-w-[180px]">
              <Field label="Limite por sacado (R$)">
                <input
                  className="w-full px-3 py-2 rounded-md border border-inputBorder text-[13px]"
                  placeholder={data.exposicao.limitePorSacadoFmt ?? 'sem limite'}
                  value={limitePorSacado}
                  onChange={(e) => setLimitePorSacado(e.target.value)}
                />
              </Field>
            </div>
            <Button size="sm" disabled={salvandoLimites} onClick={salvarLimites}>
              {salvandoLimites ? 'Salvando…' : 'Declarar capacidade'}
            </Button>
          </div>
          <div className="text-textTertiary text-[12px] mb-4">Deixe um campo vazio para remover aquele teto — vazio significa sem limite, não zero.</div>
          {erroLimites && <Notice variant="danger" className="mb-4">{erroLimites}</Notice>}

          {data.exposicao.porSacado.length === 0 ? (
            <Notice variant="neutral">Nenhuma exposição em aberto no momento.</Notice>
          ) : (
            <Table label="Concentração por sacado">
              <TableHead columns="2fr 1fr 1fr" labels={['Sacado', 'Exposição', 'Apólices']} />
              <TableBody>
                {data.exposicao.porSacado.map((s) => {
                  const estourou = data.exposicao!.limitePorSacado !== null && s.valor > data.exposicao!.limitePorSacado;
                  return (
                    <TableRow key={s.chave} columns="2fr 1fr 1fr">
                      <TableCell>
                        {s.sacado}{' '}
                        {estourou && <Badge variant="danger">acima do limite</Badge>}
                      </TableCell>
                      <TableCell className="font-mono-num">{s.valorFmt}</TableCell>
                      <TableCell>{s.apolices}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      <div className="font-bold text-[15px] mb-3">Sinistros aguardando decisão</div>
      <div className="flex flex-col gap-4 mb-6">
        {data.sinistros.map((s) => (
          <div key={s.id} className="bg-white rounded-card p-6" style={{ border: `1px solid ${PALETTE.redBorder}` }}>
            <div className="flex justify-between items-start flex-wrap gap-2.5 mb-3">
              <div>
                <div className="font-mono-num font-bold text-[13px] text-textSecondary">{s.id}</div>
                <div className="font-bold text-[15px] mt-1">
                  {s.sacado} não pagou {s.cedente} — {s.valorFmt}
                </div>
                <div className="text-textSecondary text-[12.5px] mt-1">Venceu em {s.vencimento} e nunca foi vendida no marketplace</div>
              </div>
              <Badge variant="warning" size="lg">Sinistro aberto</Badge>
            </div>
            {aiById[s.id] === undefined ? (
              <Button size="sm" variant="secondary" className="mb-3" disabled={loadingAiId === s.id} onClick={() => generateAiTriagem(s.id)}>
                {loadingAiId === s.id ? 'Analisando…' : 'Gerar triagem da IA (sugestão, não decide sozinha)'}
              </Button>
            ) : aiById[s.id] ? (
              <div className="rounded-[10px] px-4 py-3.5 mb-3 bg-chip text-[13px]">
                <div className="font-bold text-blue mb-1">
                  IA: {aiById[s.id]!.assessment === 'ok' ? 'sem inconsistências encontradas' : aiById[s.id]!.assessment === 'atencao' ? 'atenção' : 'crítico'}
                </div>
                <div className="text-textSecondary">{aiById[s.id]!.reasoning}</div>
              </div>
            ) : (
              <div className="text-[12.5px] text-textSecondary mb-3">Triagem indisponível (ANTHROPIC_API_KEY não configurada no servidor).</div>
            )}
            <div className="flex items-center gap-2.5 flex-wrap">
              <input aria-label="Nota da decisão"
                className="flex-1 min-w-[220px] px-3 py-2 rounded-md border border-inputBorder text-[13px]"
                placeholder="Nota da decisão"
                value={noteById[s.id] ?? ''}
                onChange={(e) => setNoteById((prev) => ({ ...prev, [s.id]: e.target.value }))}
              />
              <Button size="sm" variant="success" disabled={busyId === s.id} onClick={() => decide(s.id, 'aprovado')}>
                Aprovar e indenizar
              </Button>
              <Button size="sm" variant="danger" disabled={busyId === s.id} onClick={() => decide(s.id, 'negado')}>
                Negar sinistro
              </Button>
            </div>
          </div>
        ))}
        {data.sinistros.length === 0 && (
          <div className="bg-white border border-border rounded-card">
            <EmptyState title="Nenhum sinistro em aberto" hint="Duplicatas seguradas, vencidas e não pagas aparecem aqui" />
          </div>
        )}
      </div>

      <div className="font-bold text-[15px] mb-3">Apólices</div>
      <div role="table" aria-label="Apólices e sinistros" className="bg-white border border-border rounded-card overflow-hidden">
        <div role="rowgroup"><div role="row"
          className="grid gap-3 px-5 py-3.5 bg-surface border-b border-border text-xs font-bold text-textSecondary uppercase tracking-wide"
          style={{ gridTemplateColumns: '1.2fr 1fr 0.9fr 0.9fr 0.9fr 0.9fr' }}
        >
          <div role="columnheader">Cedente</div>
          <div role="columnheader">Sacado</div>
          <div role="columnheader">Valor</div>
          <div role="columnheader">Vencimento</div>
          <div role="columnheader">Prêmio</div>
          <div role="columnheader">Status</div>
        </div></div>
        {data.apolices.map((a) => (
          <div role="row" key={a.id} className="grid gap-3 px-5 py-4 border-b border-border last:border-b-0 items-center text-sm" style={{ gridTemplateColumns: '1.2fr 1fr 0.9fr 0.9fr 0.9fr 0.9fr' }}>
            <div role="cell" className="font-semibold">{a.cedente}</div>
            <div role="cell" className="text-textSecondary">{a.sacado}</div>
            <div role="cell" className="font-mono-num">{a.valorFmt}</div>
            <div role="cell" className="text-textSecondary">{a.vencimento}</div>
            <div role="cell" className="font-mono-num text-green font-bold">{a.premioFmt}</div>
            <div role="cell" className="text-[11.5px] font-bold">
              {a.sinistroStatus === 'none' ? 'Sem sinistro' : a.sinistroStatus === 'aprovado' ? 'Indenizada' : 'Negada'}
            </div>
          </div>
        ))}
        {data.apolices.length === 0 && <EmptyState title="Nenhuma apólice ainda" hint="Duplicatas seguradas pela sua seguradora aparecem aqui" />}
      </div>
    </div>
  );
}
