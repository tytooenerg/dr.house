import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Logo } from '../../components/Logo';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Input';
import { useSession } from '../../state/SessionContext';
import { DEFAULT_TAB_BY_ROLE, NAV_ITEMS } from '../../data/navConfig';
import type { Role } from '../../state/SessionContext';
import { ROLES, INSURER_OPTIONS, RoleShape } from './LoginPage';
import { PALETTE } from '../../lib/palette';

// Second step of "Entrar com SSO corporativo" for a brand-new email — the identity
// provider already authenticated the person (see server routes/auth.ts POST
// /auth/saml/complete-signup), this page only collects what the IdP assertion can't
// provide: role and company name. No password field — the account is SSO-only unless the
// user later sets one from Perfil.
export function CompleteSamlSignupPage() {
  const { user, completeSamlSignup, authError } = useSession();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const signupToken = searchParams.get('signupToken') || '';
  const nome = searchParams.get('nome') || '';
  const email = searchParams.get('email') || '';

  const [companyName, setCompanyName] = useState('');
  const [role, setRole] = useState<Role | null>(null);
  const [insurerKey, setInsurerKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user) return;
    const tab = DEFAULT_TAB_BY_ROLE[user.role];
    const item = NAV_ITEMS.find((i) => i.key === tab);
    navigate(item?.path || '/app/dashboard', { replace: true });
  }, [user, navigate]);

  if (!signupToken) {
    return (
      <div className="w-full min-h-screen flex items-center justify-center bg-bg p-6">
        <div className="w-full max-w-[420px] bg-white border border-border rounded-2xl p-9 text-center">
          <div className="text-xl font-extrabold mb-2">Link inválido</div>
          <div className="text-textSecondary text-[13.5px]">Volte e tente entrar com o SSO corporativo novamente.</div>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!role) return;
    if (role === 'seguradora' && !insurerKey) return;
    setSubmitting(true);
    try {
      await completeSamlSignup({ signupToken, companyName, role, insurerKey: role === 'seguradora' ? insurerKey! : undefined });
    } catch {
      // authError is surfaced below
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full min-h-screen flex items-center justify-center bg-bg p-6">
      <div className="w-full max-w-[420px] bg-white border border-border rounded-2xl p-9">
        <div className="flex items-center gap-2.5 mb-7">
          <Logo />
        </div>
        <div className="text-xl font-extrabold mb-1">Quase lá, {nome.split(' ')[0] || 'bem-vindo(a)'}</div>
        <div className="text-textSecondary text-[13.5px] mb-6">
          Confirmamos sua identidade via SSO corporativo (<b>{email}</b>). Só falta escolher como você vai acessar a plataforma.
        </div>

        <form onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2.5 mb-4">
            {ROLES.map((r) => {
              const selected = role === r.key;
              return (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => {
                    setRole(r.key);
                    if (r.key !== 'seguradora') setInsurerKey(null);
                  }}
                  className="flex items-center gap-3 px-4 py-3.5 rounded-[10px] cursor-pointer text-left transition-colors"
                  style={{ border: `2px solid ${selected ? PALETTE.blue : PALETTE.border}`, background: selected ? PALETTE.chip : '#fff' }}
                >
                  <div className="w-[34px] h-[34px] rounded-lg bg-chip flex items-center justify-center flex-shrink-0">
                    <RoleShape shape={r.shape} />
                  </div>
                  <div>
                    <div className="font-bold text-sm">{r.title}</div>
                    <div className="text-textSecondary text-xs mt-0.5">{r.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>

          {role === 'seguradora' && (
            <div className="mb-4">
              <div className="text-[12.5px] font-bold text-textSecondary mb-1.5">Qual seguradora sua conta representa?</div>
              <div className="flex flex-col gap-2">
                {INSURER_OPTIONS.map((ins) => (
                  <button
                    key={ins.key}
                    type="button"
                    onClick={() => setInsurerKey(ins.key)}
                    className="px-3.5 py-2.5 rounded-lg border text-[13.5px] font-semibold text-left cursor-pointer"
                    style={{ borderColor: insurerKey === ins.key ? PALETTE.blue : PALETTE.border, background: insurerKey === ins.key ? PALETTE.chip : '#fff' }}
                  >
                    {ins.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mb-5">
            <Field label="Nome da empresa">
              <Input required value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Sua empresa Ltda" />
            </Field>
          </div>

          {authError && <div className="mb-4 px-3.5 py-3 rounded-lg bg-redBg text-red text-[13px] font-semibold">{authError}</div>}
          <Button type="submit" className="w-full" disabled={!role || (role === 'seguradora' && !insurerKey) || !companyName.trim() || submitting}>
            {submitting ? 'Concluindo…' : 'Concluir cadastro'}
          </Button>
        </form>
      </div>
    </div>
  );
}
