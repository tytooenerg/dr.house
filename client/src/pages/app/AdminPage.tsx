import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';

interface PendingKyb {
  id: number;
  nome: string;
  email: string;
  companyName: string;
  kybForm: { cnpj?: string; tipo?: string; pl?: string };
  submittedAt: string;
  pldStatus: 'clear' | 'flagged';
  pldMatchNote: string;
}

interface AdminDispute {
  id: number;
  duplicataId: string;
  sacado: string;
  cedente: string;
  valorFmt: string;
  motivo: string;
  timeline: { autor: string; texto: string; quando: string }[];
}

interface AuditEntry {
  id: number;
  actor: string;
  action: string;
  payload: Record<string, unknown>;
  hash: string;
  quando: string;
}

type Tab = 'kyb' | 'disputas' | 'auditoria';

export function AdminPage() {
  const [tab, setTab] = useState<Tab>('kyb');
  const [pending, setPending] = useState<PendingKyb[]>([]);
  const [disputes, setDisputes] = useState<AdminDispute[]>([]);
  const [audit, setAudit] = useState<{ entries: AuditEntry[]; chain: { valid: boolean; brokenAt: number | null } } | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [noteById, setNoteById] = useState<Record<number, string>>({});

  const loadKyb = () => api.get<{ pending: PendingKyb[] }>('/admin/kyb').then((d) => setPending(d.pending));
  const loadDisputes = () => api.get<{ disputes: AdminDispute[] }>('/admin/disputes').then((d) => setDisputes(d.disputes));
  const loadAudit = () => api.get<{ entries: AuditEntry[]; chain: { valid: boolean; brokenAt: number | null } }>('/admin/audit').then(setAudit);

  useEffect(() => {
    loadKyb();
    loadDisputes();
    loadAudit();
  }, []);

  const approve = async (userId: number) => {
    await api.post(`/admin/kyb/${userId}/approve`);
    loadKyb();
    loadAudit();
  };

  const reject = async (userId: number) => {
    if (!rejectReason.trim()) return;
    await api.post(`/admin/kyb/${userId}/reject`, { reason: rejectReason.trim() });
    setRejectingId(null);
    setRejectReason('');
    loadKyb();
    loadAudit();
  };

  const arbitrate = async (id: number, decision: 'cedente' | 'sacado') => {
    const note = noteById[id]?.trim();
    if (!note) return;
    await api.post(`/admin/disputes/${id}/resolve`, { decision, note });
    loadDisputes();
    loadAudit();
  };

  return (
    <div>
      <PageHeader title="Back-office" subtitle="Aprovação de credenciamento, arbitragem de disputas e trilha de auditoria da plataforma" />

      <div className="flex gap-1 mb-5 p-1 rounded-lg bg-bg w-fit">
        {([
          ['kyb', `Fila de KYB (${pending.length})`],
          ['disputas', `Disputas (${disputes.length})`],
          ['auditoria', 'Auditoria'],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className="px-4 py-2 rounded-md text-[13px] font-bold cursor-pointer"
            style={{ background: tab === key ? '#fff' : 'transparent', color: tab === key ? '#0B1F3A' : '#5B6472' }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'kyb' && (
        <div className="flex flex-col gap-4">
          {pending.map((p) => (
            <div key={p.id} className="bg-white border border-border rounded-card p-6">
              <div className="flex justify-between items-start flex-wrap gap-2.5 mb-3">
                <div>
                  <div className="font-bold text-[16px]">{p.companyName}</div>
                  <div className="text-textSecondary text-[13px]">
                    {p.nome} · {p.email}
                  </div>
                </div>
                <span className="text-[11.5px] font-bold px-3 py-1.5 rounded-md bg-amberBg text-amber">Aguardando análise — {p.submittedAt}</span>
              </div>
              {p.pldStatus === 'flagged' && (
                <div className="rounded-[10px] px-4 py-3 mb-3 text-[12.5px]" style={{ background: '#F7E9E7', color: '#B3261E' }}>
                  <b>PLD/FT — possível correspondência (lista de demonstração)</b>
                  <div className="mt-0.5">{p.pldMatchNote}</div>
                </div>
              )}
              <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                <div className="text-[13px]">
                  <div className="text-textTertiary text-[11.5px] uppercase font-bold mb-1">CNPJ</div>
                  {p.kybForm.cnpj || '—'}
                </div>
                <div className="text-[13px]">
                  <div className="text-textTertiary text-[11.5px] uppercase font-bold mb-1">Tipo</div>
                  {p.kybForm.tipo || '—'}
                </div>
                <div className="text-[13px]">
                  <div className="text-textTertiary text-[11.5px] uppercase font-bold mb-1">PL para alocação</div>
                  R$ {p.kybForm.pl || '—'}
                </div>
              </div>

              {rejectingId === p.id ? (
                <div className="flex items-center gap-2.5 flex-wrap">
                  <input
                    className="flex-1 min-w-[220px] px-3 py-2 rounded-md border border-inputBorder text-[13px]"
                    placeholder="Motivo da rejeição"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                  />
                  <Button size="sm" variant="danger" onClick={() => reject(p.id)}>
                    Confirmar rejeição
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRejectingId(null)}>
                    Cancelar
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2.5">
                  <Button size="sm" variant="success" onClick={() => approve(p.id)}>
                    Aprovar credenciamento
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setRejectingId(p.id)}>
                    Rejeitar
                  </Button>
                </div>
              )}
            </div>
          ))}
          {pending.length === 0 && (
            <div className="bg-white border border-border rounded-card">
              <EmptyState title="Nenhum credenciamento pendente" hint="Novas solicitações de investidores institucionais aparecem aqui" />
            </div>
          )}
        </div>
      )}

      {tab === 'disputas' && (
        <div className="flex flex-col gap-4">
          {disputes.map((d) => (
            <div key={d.id} className="bg-white border border-border rounded-card p-6">
              <div className="flex justify-between items-start flex-wrap gap-2.5 mb-3">
                <div>
                  <div className="font-mono-num font-bold text-[13px] text-textSecondary">{d.duplicataId}</div>
                  <div className="font-bold text-[16px] mt-1">
                    {d.cedente} vs {d.sacado} — {d.valorFmt}
                  </div>
                </div>
              </div>
              <div className="rounded-[10px] px-4 py-3.5 mb-3 bg-amberBg text-sm">{d.motivo}</div>
              <div className="flex flex-col gap-2 mb-3.5">
                {d.timeline.map((t, i) => (
                  <div key={i} className="text-[13px]">
                    <b>{t.autor}</b> {t.texto} <span className="text-textMuted">— {t.quando}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <input
                  className="flex-1 min-w-[220px] px-3 py-2 rounded-md border border-inputBorder text-[13px]"
                  placeholder="Nota da decisão de arbitragem"
                  value={noteById[d.id] ?? ''}
                  onChange={(e) => setNoteById((prev) => ({ ...prev, [d.id]: e.target.value }))}
                />
                <Button size="sm" variant="success" onClick={() => arbitrate(d.id, 'cedente')}>
                  Decidir a favor do cedente
                </Button>
                <Button size="sm" variant="danger" onClick={() => arbitrate(d.id, 'sacado')}>
                  Decidir a favor do sacado
                </Button>
              </div>
            </div>
          ))}
          {disputes.length === 0 && (
            <div className="bg-white border border-border rounded-card">
              <EmptyState title="Nenhuma disputa em aberto" hint="Disputas escaladas pelo cedente aparecem aqui para arbitragem" />
            </div>
          )}
        </div>
      )}

      {tab === 'auditoria' && (
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
      )}
    </div>
  );
}
