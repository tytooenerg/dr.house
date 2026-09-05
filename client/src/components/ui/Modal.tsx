import { useEffect, useRef } from 'react';

export function ModalOverlay({ children, maxWidth = 440, onClose }: { children: React.ReactNode; maxWidth?: number; onClose?: () => void }) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusable = contentRef.current?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    focusable?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && onClose) {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !contentRef.current) return;
      const focusables = contentRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[100] p-6" style={{ background: 'rgba(11,31,58,0.55)' }}>
      <div ref={contentRef} role="dialog" aria-modal="true" className="w-full bg-white rounded-2xl p-9" style={{ maxWidth }}>
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
      className="grid gap-3 px-5 py-3.5 bg-surface border-b border-border text-[12px] font-bold text-textSecondary uppercase tracking-wide"
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
