import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../lib/api';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { PALETTE } from '../../../lib/palette';
import { useApi } from '../../../lib/useApi';

interface AuditEntry {
  id: number;
  actor: string;
  action: string;
  payload: Record<string, unknown>;
  hash: string;
  quando: string;
}

export function AuditTrailPanel() {

  const { data: audit, error: loadError, reload: load, setData: setAudit } = useApi<{ entries: AuditEntry[]; chain: { valid: boolean; brokenAt: number | null } }>('/admin/audit', { fallbackMessage: 'Falha ao carregar a trilha de auditoria.' });

  if (loadError) return <ErrorState message={loadError} onRetry={load} />;

  return (
    <div className="bg-white border border-border rounded-card overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
        <div className="font-bold text-[14px]">Trilha de auditoria (hash chain)</div>
        {audit && (
          <span
            className="text-[11.5px] font-bold px-2.5 py-1 rounded-md"
            style={audit.chain.valid ? { background: PALETTE.greenBg, color: PALETTE.green } : { background: PALETTE.redBg, color: PALETTE.red }}
          >
            {audit.chain.valid ? 'Cadeia íntegra ✓' : `Violação detectada no evento #${audit.chain.brokenAt}`}
          </span>
        )}
      </div>
      {(audit?.entries ?? []).map((e) => (
        <div key={e.id} className="px-5 py-3 border-b border-bg last:border-b-0 flex items-center justify-between gap-3 text-[13px]">
          <div>
            <b>{e.actor}</b> — {e.action}
            <span className="text-textMuted"> · {e.quando}</span>
          </div>
          <span className="font-mono-num text-[11.5px] text-textTertiary">#{e.hash}</span>
        </div>
      ))}
      {audit && audit.entries.length === 0 && <EmptyState title="Nenhum evento registrado ainda" hint="Ações sensíveis da plataforma vão aparecer aqui" />}
    </div>
  );
}
