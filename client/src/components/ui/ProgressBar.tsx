import { PALETTE } from '../../lib/palette';
export function ProgressBar({ pct, color, height = 6, bg = PALETTE.hairline }: { pct: number; color: string; height?: number; bg?: string }) {
  return (
    <div className="rounded-full overflow-hidden" style={{ height, background: bg }}>
      <div className="h-full rounded-full transition-all duration-300" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
    </div>
  );
}

export function RangeBar({ leftPct, widthPct, color, height = 10 }: { leftPct: number; widthPct: number; color: string; height?: number }) {
  return (
    <div className="relative rounded-full bg-hairline" style={{ height }}>
      <div className="absolute top-0 bottom-0 rounded-full" style={{ left: `${leftPct}%`, width: `${widthPct}%`, background: color }} />
    </div>
  );
}
