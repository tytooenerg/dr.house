import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { EmptyState } from '../../../components/ui/EmptyState';

interface AuditEntry {
  id: number;
  actor: string;
  action: string;
  payload: Record<string, unknown>;
  hash: string;
  quando: string;
}

export function AuditTrailPanel() {
  const [audit, setAudit] = useState<{ entries: AuditEntry[]; chain: { valid: boolean; brokenAt: number | null } } | null>(null);

  useEffect(() => {
    api.get<{ entries: AuditEntry[]; chain: { valid: boolean; brokenAt: number | null } }>('/admin/audit').then(setAudit);
  }, []);

  return (
    <div className="bg-white border border-border rounded-card overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
        <div className="font-bold text-[14px]">Trilha de auditoria (hash chain)</div>
        {audit && (
          <span
            className="text-[11.5px] font-bold px-2.5 py-1 rounded-md"
            style={audit.chain.valid ? { background: '#EAF3EE', color: '#0A5C36' } : { background: '#F7E9E7', color: '#B3261E' }}
          >
            {audit.chain.valid ? 'Cadeia íntegra ✓' : `Violação detectada no evento #${audit.chain.brokenAt}`}
          </span>
        )}
      </div>
      {(audit?.entries ?? []).map((e) => (
        <div key={e.id} className="px-5 py-3 border-b border-[#F5F7FA] last:border-b-0 flex items-center justify-between gap-3 text-[13px]">
          <div>
            <b>{e.actor}</b> — {e.action}
            <span className="text-textMuted"> · {e.quando}</span>
          </div>
          <span className="font-mono-num text-[11px] text-textTertiary">#{e.hash}</span>
        </div>
      ))}
      {audit && audit.entries.length === 0 && <EmptyState title="Nenhum evento registrado ainda" hint="Ações sensíveis da plataforma vão aparecer aqui" />}
    </div>
  );
}
