import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../lib/api';
import { Button } from '../../../components/ui/Button';
import { ErrorState } from '../../../components/ui/ErrorState';

interface AuditorRow {
  id: number;
  nome: string;
  email: string;
  companyName: string;
  criadoEm: string;
}

// Creates a real read-only login for the 'auditor' role (lib/createAuditorAccount.ts) —
// the only way to get one, since it's deliberately absent from public self-registration.
export function AuditoresPanel() {
  const [auditores, setAuditores] = useState<AuditorRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ nome: '', email: '', password: '', companyName: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = () => {
    setLoadError(null);
    return api
      .get<{ auditores: AuditorRow[] }>('/admin/auditores')
      .then((d) => setAuditores(d.auditores))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Falha ao carregar contas de auditoria.'));
  };

  useEffect(() => {
    load();
  }, []);

  if (loadError) return <ErrorState message={loadError} onRetry={load} />;

  const create = async () => {
    setError('');
    if (!form.nome.trim() || !form.email.trim() || form.password.length < 8) {
      setError('Informe nome, e-mail e uma senha com ao menos 8 caracteres.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/admin/auditores', form);
      setForm({ nome: '', email: '', password: '', companyName: '' });
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível criar a conta de auditoria.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white border border-border rounded-card overflow-hidden mt-5">
      <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
        <div>
          <div className="font-bold text-[14px]">Contas de auditoria (somente leitura)</div>
          <div className="text-[12px] text-textMuted mt-0.5">Acesso a trilha de auditoria, compliance, reconciliação e relatórios regulatórios — sem nenhuma ação de escrita</div>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Fechar' : '+ Nova conta'}
        </Button>
      </div>

      {showForm && (
        <div className="px-5 py-3.5 border-b border-bg grid grid-cols-1 md:grid-cols-4 gap-2.5">
          <input placeholder="Nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} className="border border-border rounded-md px-3 py-2 text-sm" />
          <input placeholder="E-mail" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="border border-border rounded-md px-3 py-2 text-sm" />
          <input
            type="password"
            placeholder="Senha (mín. 8 caracteres)"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="border border-border rounded-md px-3 py-2 text-sm"
          />
          <input
            placeholder="Empresa/escritório (opcional)"
            value={form.companyName}
            onChange={(e) => setForm({ ...form, companyName: e.target.value })}
            className="border border-border rounded-md px-3 py-2 text-sm"
          />
          <div className="md:col-span-4 flex items-center gap-2.5">
            <Button size="sm" disabled={saving} onClick={create}>
              {saving ? 'Criando…' : 'Criar conta'}
            </Button>
            {error && <span className="text-red text-[12px] font-semibold">{error}</span>}
          </div>
        </div>
      )}

      {auditores.map((a) => (
        <div key={a.id} className="px-5 py-3 border-b border-bg last:border-b-0 flex items-center justify-between gap-3 text-[13px]">
          <div>
            <b>{a.nome}</b> — {a.email}
            <span className="text-textMuted"> · {a.companyName}</span>
          </div>
          <span className="text-textTertiary text-[11.5px]">criada {a.criadoEm}</span>
        </div>
      ))}
      {auditores.length === 0 && <div className="px-5 py-4 text-[12.5px] text-textMuted">Nenhuma conta de auditoria criada ainda.</div>}
    </div>
  );
}
