import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { PageHeader, Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Gauge } from '../../components/ui/Gauge';
import { Button } from '../../components/ui/Button';
import { AiTag } from '../../components/ui/Badge';

interface Factor {
  label: string;
  value: string;
  barPct: string;
  barColor: string;
}
interface AiSignal {
  text: string;
  color: string;
}
interface SelectedSacado {
  name: string;
  score: number;
  rating: string;
  factors: Factor[];
  scoreColor: string;
  ratingBg: string;
  ratingColor: string;
  gaugeScore: number;
  stageLabel: string;
  stageBg: string;
  stageColor: string;
  stageDesc: string;
  aiSignals: AiSignal[];
  trendIcon: string;
  trendColor: string;
  trendDelta: string;
  pd12m: string;
  hasAlerta: boolean;
  alerta: string | null;
  fonte: 'interno' | 'rede' | 'combinado';
  sinaisDeRede: { total: number; pontual: number; atraso: number; protesto: number; contestacao: number; confianca: string } | null;
}

export function RiscoPage() {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selected, setSelected] = useState<SelectedSacado | null>(null);

  useEffect(() => {
    if (selected) return;
    const t = setTimeout(() => {
      if (!query.trim()) {
        setSuggestions([]);
        return;
      }
      api
        .get<{ suggestions: string[] }>(`/risco/search?q=${encodeURIComponent(query)}`)
        .then((d) => setSuggestions(d.suggestions))
        .catch(() => setSuggestions([]));
    }, 150);
    return () => clearTimeout(t);
  }, [query, selected]);

  const select = async (name: string) => {
    const data = await api.get<SelectedSacado>(`/risco/${encodeURIComponent(name)}`);
    setQuery(name);
    setSuggestions([]);
    setSelected(data);
  };

  const clear = () => {
    setQuery('');
    setSelected(null);
  };

  return (
    <div>
      <PageHeader title="Análise de Risco do Sacado" subtitle="Consulte o score de crédito antes de comprar uma duplicata" />

      <div className="relative max-w-[440px] mb-5">
        <Input placeholder="Buscar empresa sacada (ex: Grupo Atlas)" value={query} onChange={(e) => setQuery(e.target.value)} />
        {suggestions.length > 0 && (
          <div className="absolute top-[calc(100%+6px)] left-0 right-0 bg-white border border-border rounded-[10px] shadow-dropdown overflow-hidden z-10">
            {suggestions.map((s) => (
              <div key={s} className="px-4 py-3 cursor-pointer text-sm font-semibold border-b border-hairline last:border-b-0" onClick={() => select(s)}>
                {s}
              </div>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1.4fr' }}>
          <Card className="p-7 flex flex-col items-center">
            <Gauge
              pct={selected.gaugeScore}
              color={selected.scoreColor}
              size={150}
              innerLabel={
                <div className="text-[30px] font-extrabold" style={{ color: selected.scoreColor }}>
                  {selected.score}
                </div>
              }
              innerSub={<div className="text-[11px] text-textSecondary">score de 0–100</div>}
            />
            <div className="font-bold text-base mt-[18px]">{selected.name}</div>
            <span className="text-[12.5px] font-bold px-2.5 py-1 rounded-md mt-2" style={{ background: selected.ratingBg, color: selected.ratingColor }}>
              Rating {selected.rating}
            </span>
            {selected.sinaisDeRede && (
              <div className="text-[11.5px] text-textTertiary mt-2 text-center">
                {selected.fonte === 'rede' ? 'Score de rede' : 'Score combinado (interno + rede)'} — {selected.sinaisDeRede.total} sinal(is) de parceiros,
                confiança {selected.sinaisDeRede.confianca}
              </div>
            )}
            <div className="flex items-center gap-1.5 mt-2.5 text-[12.5px] font-semibold" style={{ color: selected.trendColor }}>
              <span>{selected.trendIcon}</span>
              <span>{selected.trendDelta}</span>
            </div>
            <div className="text-xs text-textSecondary mt-1">PD 12m (probabilidade de default): {selected.pd12m}</div>
            <div className="w-full mt-4 p-3 rounded-[10px]" style={{ background: selected.stageBg }}>
              <div className="text-[12.5px] font-extrabold" style={{ color: selected.stageColor }}>
                {selected.stageLabel} de provisionamento
              </div>
              <div className="text-[11.5px] text-textSecondary mt-1 leading-snug">{selected.stageDesc}</div>
            </div>
            <Button variant="secondary" size="sm" className="mt-5 bg-[#F0F2F5] text-textSecondary border-none" onClick={clear}>
              Nova busca
            </Button>
          </Card>

          <Card className="p-7">
            <div className="font-bold text-[15px] mb-[18px]">Fatores de risco</div>
            <div className="flex flex-col gap-4">
              {selected.factors.map((f) => (
                <div key={f.label}>
                  <div className="flex justify-between text-[13.5px] mb-1.5">
                    <span className="font-semibold">{f.label}</span>
                    <span className="text-textSecondary">{f.value}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-hairline overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-300" style={{ width: f.barPct, background: f.barColor }} />
                  </div>
                </div>
              ))}
            </div>

            <div className="h-px bg-[#EEF1F5] my-5" />

            <div className="flex items-center gap-2 mb-3.5">
              <AiTag />
              <div className="font-bold text-sm">Sinais adicionais monitorados</div>
            </div>
            {selected.hasAlerta && (
              <div className="flex gap-2 p-3 rounded-lg bg-amberBg mb-3.5">
                <span className="text-[10.5px] font-extrabold px-2 py-1 rounded-md bg-[#F0D9A8] text-[#8A5A00] h-fit">Preditivo</span>
                <div className="text-[12.5px] text-[#5B4200] leading-snug">{selected.alerta}</div>
              </div>
            )}
            <div className="flex flex-col gap-2.5">
              {selected.aiSignals.map((s, i) => (
                <div key={i} className="flex items-start gap-2 text-[12.5px]">
                  <span className="rounded-full mt-1.5 flex-shrink-0" style={{ width: 6, height: 6, background: s.color }} />
                  <span className="text-[#3D4658]">{s.text}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
