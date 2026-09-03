import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { Card } from './ui/Card';
import { Select } from './ui/Input';
import { Button } from './ui/Button';
import { ErrorState } from './ui/ErrorState';

type FaturamentoBracket = 'acima_300m' | 'entre_90m_300m' | 'entre_4_8m_90m' | 'ate_4_8m';
type Status = 'nao_informado' | 'assistida_disponivel' | 'obrigatorio_pleno';

interface ComplianceCalendarView {
  bracket: FaturamentoBracket | null;
  bracketLabel: string | null;
  status: Status;
  statusLabel: string;
  obrigatorioEmFmt: string | null;
  diasRestantes: number | null;
  producaoAssistidaDisponivelDesdeFmt: string;
}

const BRACKET_OPTIONS: { value: FaturamentoBracket; label: string }[] = [
  { value: 'acima_300m', label: 'Acima de R$ 300 milhões/ano' },
  { value: 'entre_90m_300m', label: 'Entre R$ 90 milhões e R$ 300 milhões/ano' },
  { value: 'entre_4_8m_90m', label: 'Entre R$ 4,8 milhões e R$ 90 milhões/ano' },
  { value: 'ate_4_8m', label: 'Até R$ 4,8 milhões/ano' },
];

const STATUS_STYLE: Record<Status, { bg: string; color: string }> = {
  nao_informado: { bg: '#F0F2F5', color: '#5B6472' },
  assistida_disponivel: { bg: '#FBF1E0', color: '#8A5A00' },
  obrigatorio_pleno: { bg: '#EAF3EE', color: '#0A5C36' },
};

// Card compartilhado entre CompliancePage (cedente) e SacadoPage (sacado) — cada um
// informa sua própria faixa de faturamento e vê seu próprio prazo de obrigatoriedade da
// duplicata escritural (BCB). Busca e salva por conta própria, sem depender da página que
// o hospeda.
export function ComplianceCalendarCard() {
  const [view, setView] = useState<ComplianceCalendarView | null>(null);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<FaturamentoBracket>('ate_4_8m');
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = () => {
    setLoadError(null);
    api
      .get<ComplianceCalendarView>('/conformidade')
      .then((v) => {
        setView(v);
        setEditing(v.bracket === null);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Falha ao carregar seu prazo de conformidade.'));
  };

  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const v = await api.post<ComplianceCalendarView>('/conformidade/faturamento', { bracket: selected });
      setView(v);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (loadError) return <ErrorState message={loadError} onRetry={load} />;
  if (!view) return null;
  const style = STATUS_STYLE[view.status];

  return (
    <Card className="mb-4">
      <div className="font-bold text-[15px] mb-1">Meu prazo de conformidade — Duplicata Escritural</div>
      <div className="text-textSecondary text-[12.5px] mb-3.5">
        Baseado no cronograma de obrigatoriedade do Banco Central por faixa de faturamento anual — adesão voluntária desde{' '}
        {view.producaoAssistidaDisponivelDesdeFmt}.
      </div>

      {editing ? (
        <div className="flex gap-2.5 max-w-[560px] flex-wrap items-center">
          <Select value={selected} onChange={(e) => setSelected(e.target.value as FaturamentoBracket)} className="flex-1 min-w-[220px]">
            {BRACKET_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar faturamento anual'}
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[13.5px] font-semibold">{view.bracketLabel}</div>
            <span className="inline-block mt-1.5 text-[11.5px] font-bold px-2.5 py-1 rounded-md" style={{ background: style.bg, color: style.color }}>
              {view.statusLabel}
            </span>
          </div>
          {view.status === 'assistida_disponivel' && view.diasRestantes !== null && (
            <div className="text-right">
              <div className="text-xl font-extrabold font-mono-num">{view.diasRestantes}</div>
              <div className="text-textSecondary text-xs">dias até o prazo obrigatório</div>
            </div>
          )}
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Alterar faturamento informado
          </Button>
        </div>
      )}
    </Card>
  );
}
