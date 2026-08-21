export function Badge({ label, bg, color, className = '' }: { label: string; bg: string; color: string; className?: string }) {
  return (
    <span
      className={`inline-flex items-center text-[11.5px] font-bold px-2.5 py-1 rounded-md w-fit ${className}`}
      style={{ background: bg, color }}
    >
      {label}
    </span>
  );
}

export function Dot({ color, size = 7, className = '' }: { color: string; size?: number; className?: string }) {
  return <span className={`rounded-full flex-shrink-0 ${className}`} style={{ background: color, width: size, height: size }} />;
}

export function AiTag({ label = 'IA' }: { label?: string }) {
  return <span className="text-[10.5px] font-extrabold px-2 py-0.5 rounded-md bg-chip text-blue">{label}</span>;
}
