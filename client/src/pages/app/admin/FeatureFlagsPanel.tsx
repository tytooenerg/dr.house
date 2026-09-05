import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../lib/api';
import { Button } from '../../../components/ui/Button';
import { ErrorState } from '../../../components/ui/ErrorState';

interface FeatureFlagView {
  key: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
  enabled: boolean;
  rolloutPct: number;
  isOverridden: boolean;
  updatedAt: string | null;
}

export function FeatureFlagsPanel() {
  const [flags, setFlags] = useState<FeatureFlagView[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [rolloutInputs, setRolloutInputs] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = () => {
    setLoadError(null);
    return api
      .get<{ flags: FeatureFlagView[] }>('/admin/feature-flags')
      .then((d) => {
        setFlags(d.flags);
        setRolloutInputs(Object.fromEntries(d.flags.map((f) => [f.key, String(f.rolloutPct)])));
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Falha ao carregar as feature flags.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const save = async (flag: FeatureFlagView, enabled: boolean) => {
    setError('');
    setSavingKey(flag.key);
    const rolloutPct = Math.max(0, Math.min(100, Number(rolloutInputs[flag.key]) || 100));
    try {
      const d = await api.post<{ flags: FeatureFlagView[] }>(`/admin/feature-flags/${flag.key}`, { enabled, rolloutPct });
      setFlags(d.flags);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar a flag.');
    } finally {
      setSavingKey(null);
    }
  };

  if (loading) return <p className="text-[13px] text-navy/60">Carregando…</p>;
  if (loadError) return <ErrorState message={loadError} onRetry={load} />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-[15px] font-bold text-navy">Feature flags</h2>
        <p className="text-[13px] text-navy/60 mt-1">
          Kill switches operacionais que qualquer admin pode acionar sem depender de um novo deploy. Cada flag abaixo controla um ponto real do
          sistema — veja server/src/lib/featureFlags.ts para a lista completa de onde cada uma é checada.
        </p>
      </div>
      {error && <p className="text-[12.5px] text-red font-semibold">{error}</p>}
      <div className="flex flex-col gap-3">
        {flags.map((f) => (
          <div key={f.key} className="border border-border rounded-xl p-4 flex flex-col gap-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-bold text-navy">{f.label}</span>
                  <code className="text-[10.5px] text-navy/50 bg-bg px-1.5 py-0.5 rounded">{f.key}</code>
                  {!f.isOverridden && (
                    <span className="text-[10.5px] font-bold text-navy/40 uppercase tracking-wide">padrão</span>
                  )}
                </div>
                <p className="text-[12.5px] text-navy/60 mt-1 max-w-2xl">{f.description}</p>
              </div>
              <Button
                variant={f.enabled ? 'secondary' : 'primary'}
                disabled={savingKey === f.key}
                onClick={() => save(f, !f.enabled)}
              >
                {f.enabled ? 'Desativar' : 'Ativar'}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[12.5px] text-navy/60">Rollout:</span>
              <input
                type="number"
                min={0}
                max={100}
                value={rolloutInputs[f.key] ?? '100'}
                onChange={(e) => setRolloutInputs((prev) => ({ ...prev, [f.key]: e.target.value }))}
                className="w-16 border border-border rounded-md px-2 py-1 text-[12.5px]"
              />
              <span className="text-[12.5px] text-navy/60">%</span>
              <Button variant="ghost" disabled={savingKey === f.key} onClick={() => save(f, f.enabled)}>
                Salvar %
              </Button>
              {f.updatedAt && <span className="text-[11.5px] text-navy/40 ml-auto">Alterada em {f.updatedAt}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
