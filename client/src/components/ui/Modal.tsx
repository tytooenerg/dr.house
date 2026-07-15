export function ModalOverlay({ children, maxWidth = 440 }: { children: React.ReactNode; maxWidth?: number }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center z-[100] p-6" style={{ background: 'rgba(11,31,58,0.55)' }}>
      <div className="w-full bg-white rounded-2xl p-9" style={{ maxWidth }}>
        {children}
      </div>
    </div>
  );
}

export function Table({ children }: { children: React.ReactNode }) {
  return <div className="bg-white border border-border rounded-card overflow-hidden">{children}</div>;
}

export function TableHead({ columns, labels }: { columns: string; labels: string[] }) {
  return (
    <div
      className="grid gap-3 px-5 py-3.5 bg-[#F7F8FA] border-b border-border text-[12px] font-bold text-textSecondary uppercase tracking-wide"
      style={{ gridTemplateColumns: columns }}
    >
      {labels.map((l) => (
        <div key={l}>{l}</div>
      ))}
    </div>
  );
}

export function TableRow({ columns, className = '', children }: { columns: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`grid gap-3 px-5 py-4 items-center text-sm border-b border-border last:border-b-0 ${className}`} style={{ gridTemplateColumns: columns }}>
      {children}
    </div>
  );
}
