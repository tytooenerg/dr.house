export function Gauge({ pct, color, size = 150, innerLabel, innerSub }: { pct: number; color: string; size?: number; innerLabel: React.ReactNode; innerSub?: React.ReactNode }) {
  const inner = size * 0.73;
  return (
    <div
      className="rounded-full flex items-center justify-center"
      style={{ width: size, height: size, background: `conic-gradient(${color} 0% ${pct}%, #E4E8EE ${pct}% 100%)` }}
    >
      <div className="rounded-full bg-white flex flex-col items-center justify-center" style={{ width: inner, height: inner }}>
        {innerLabel}
        {innerSub}
      </div>
    </div>
  );
}

export function Donut({
  stops,
  size = 150,
  innerBg = '#fff',
  children,
}: {
  stops: { color: string; from: number; to: number }[];
  size?: number;
  innerBg?: string;
  children?: React.ReactNode;
}) {
  const gradient = stops.map((s) => `${s.color} ${s.from}% ${s.to}%`).join(', ');
  const inner = size * 0.64;
  return (
    <div className="rounded-full flex items-center justify-center" style={{ width: size, height: size, background: `conic-gradient(${gradient})` }}>
      <div className="rounded-full flex flex-col items-center justify-center" style={{ width: inner, height: inner, background: innerBg }}>
        {children}
      </div>
    </div>
  );
}
