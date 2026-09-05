import { useEffect, useState } from 'react';
import { PublicNav, PublicFooter } from './PublicChrome';
import { PALETTE } from '../../lib/palette';

interface StatusData {
  current: { status: 'ok' | 'degraded'; latencyMs: number; checkedAt: string } | null;
  uptimePct24h: number | null;
  uptimePct7d: number | null;
  history: { status: 'ok' | 'degraded'; latencyMs: number; checkedAt: string }[];
}

export function StatusPage() {
  const [data, setData] = useState<StatusData | null>(null);

  useEffect(() => {
    fetch('/api/public/status')
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  const ok = data?.current?.status === 'ok';

  return (
    <div className="w-full text-navy min-h-screen">
      <PublicNav active="status" />
      <div className="max-w-[720px] mx-auto px-6 py-16">
        <div className="text-[38px] font-extrabold tracking-tight mb-2">Status da plataforma</div>
        <div className="text-textSecondary text-[15px] mb-8">
          Verificações reais da API, registradas automaticamente a cada minuto — não é um selo estático.
        </div>

        {!data && <div className="text-textTertiary">Carregando…</div>}

        {data && (
          <>
            <div className="flex items-center gap-2.5 mb-7">
              <span className="rounded-full" style={{ width: 9, height: 9, background: ok ? PALETTE.green : PALETTE.red }} />
              <span className="text-[14.5px] font-bold" style={{ color: ok ? PALETTE.green : PALETTE.red }}>
                {data.current ? (ok ? 'Operacional' : 'Degradado') : 'Sem dados ainda'}
              </span>
              {data.current && <span className="text-textTertiary text-[13px]">· última verificação {data.current.checkedAt}</span>}
            </div>

            <div className="grid gap-4 mb-8" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="border border-border rounded-card p-5">
                <div className="text-textTertiary text-[11.5px] font-bold uppercase mb-1.5">Uptime (24h)</div>
                <div className="text-[26px] font-extrabold">{data.uptimePct24h != null ? `${data.uptimePct24h}%` : '—'}</div>
              </div>
              <div className="border border-border rounded-card p-5">
                <div className="text-textTertiary text-[11.5px] font-bold uppercase mb-1.5">Uptime (7 dias)</div>
                <div className="text-[26px] font-extrabold">{data.uptimePct7d != null ? `${data.uptimePct7d}%` : '—'}</div>
              </div>
            </div>

            <div className="font-bold text-[15px] mb-3">Histórico de verificações</div>
            <div className="border border-border rounded-card overflow-hidden">
              {data.history.length === 0 && <div className="px-5 py-4 text-textTertiary text-[13px]">Nenhuma verificação registrada ainda.</div>}
              {data.history.map((h, i) => (
                <div key={i} className="flex justify-between items-center px-5 py-3 border-b border-hairline last:border-b-0 text-[13px]">
                  <div className="flex items-center gap-2 font-semibold" style={{ color: h.status === 'ok' ? PALETTE.green : PALETTE.red }}>
                    <span className="rounded-full" style={{ width: 7, height: 7, background: h.status === 'ok' ? PALETTE.green : PALETTE.red }} />
                    {h.status === 'ok' ? 'Operacional' : 'Degradado'}
                  </div>
                  <div className="text-textSecondary font-mono-num">{h.latencyMs}ms</div>
                  <div className="text-textTertiary">{h.checkedAt}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      <PublicFooter />
    </div>
  );
}
