import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Logo } from '../../components/Logo';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Input';
import { useSession } from '../../state/SessionContext';
import { DEFAULT_TAB_BY_ROLE, NAV_ITEMS } from '../../data/navConfig';
import type { Role } from '../../state/SessionContext';
import { KybModal } from './KybModal';

const ROLES: { key: Role; title: string; desc: string; shape: 'circle' | 'square' | 'diamond' | 'triangle' }[] = [
  { key: 'investidor', title: 'Investidor / Financiador', desc: 'Comprar duplicatas, gerir carteira e risco', shape: 'circle' },
  { key: 'cedente', title: 'Empresa (cedente)', desc: 'Emitir e antecipar suas duplicatas', shape: 'square' },
  { key: 'sacado', title: 'Empresa (sacado)', desc: 'Confirmar ou contestar duplicatas recebidas', shape: 'diamond' },
  { key: 'seguradora', title: 'Seguradora parceira', desc: 'Acompanhar apólices e decidir sinistros', shape: 'triangle' },
];

// Mirrors server/src/data/seed.ts INSURERS — needed here because registration happens
// before any authenticated call can fetch the list from the API.
const INSURER_OPTIONS = [
  { key: 'too', name: 'Too Seguros' },
  { key: 'pottencial', name: 'Pottencial Seguradora' },
  { key: 'junto', name: 'Junto Seguros' },
];

function RoleShape({ shape }: { shape: 'circle' | 'square' | 'diamond' | 'triangle' }) {
  if (shape === 'triangle') {
    return <div style={{ width: 0, height: 0, borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderBottom: '11px solid #1E5EFF' }} />;
  }
  const style: React.CSSProperties = { width: 12, height: 12, border: '2px solid #1E5EFF' };
  if (shape === 'circle') style.borderRadius = '50%';
  if (shape === 'diamond') style.transform = 'rotate(45deg)';
  return <div style={style} />;
}

export function LoginPage() {
  const { user, loading, login, verifyTwoFactor, register, authError } = useSession();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [submitting, setSubmitting] = useState(false);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');

  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [role, setRole] = useState<Role | null>(null);
  const [insurerKey, setInsurerKey] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    if (user.needsKyb) return;
    const tab = DEFAULT_TAB_BY_ROLE[user.role];
    const item = NAV_ITEMS.find((i) => i.key === tab);
    navigate(item?.path || '/app/dashboard', { replace: true });
  }, [user, navigate]);

  if (loading) return null;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const result = await login(loginEmail, loginPassword);
      if (result.twoFactorRequired && result.challengeToken) setChallengeToken(result.challengeToken);
    } catch {
      // authError is surfaced below
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyTwoFactor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!challengeToken) return;
    setSubmitting(true);
    try {
      await verifyTwoFactor(challengeToken, twoFactorCode.trim());
    } catch {
      // authError is surfaced below
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!role) return;
    if (role === 'seguradora' && !insurerKey) return;
    setSubmitting(true);
    try {
      const referralCode = new URLSearchParams(window.location.search).get('ref') ?? undefined;
      await register({ nome, email, password, companyName, role, insurerKey: role === 'seguradora' ? insurerKey! : undefined, referralCode });
    } catch {
      // authError is surfaced below
    } finally {
      setSubmitting(false);
    }
  };

  if (user?.needsKyb) {
    return (
      <div className="w-full min-h-screen bg-bg">
        <KybModal />
      </div>
    );
  }

  if (challengeToken) {
    return (
      <div className="w-full min-h-screen flex items-center justify-center bg-bg p-6">
        <div className="w-full max-w-[420px] bg-white border border-border rounded-2xl p-9">
          <div className="flex items-center gap-2.5 mb-7">
            <Logo />
          </div>
          <form onSubmit={handleVerifyTwoFactor}>
            <div className="text-xl font-extrabold mb-1">Verificação em duas etapas</div>
            <div className="text-textSecondary text-[13.5px] mb-6">Digite o código de 6 dígitos do seu app autenticador, ou um código de recuperação.</div>
            <div className="mb-5">
              <Field label="Código">
                <Input
                  autoFocus
                  required
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value)}
                  placeholder="000000"
                  inputMode="numeric"
                  maxLength={11}
                />
              </Field>
            </div>
            {authError && <div className="mb-4 px-3.5 py-3 rounded-lg bg-redBg text-red text-[13px] font-semibold">{authError}</div>}
            <Button type="submit" className="w-full" disabled={submitting || !twoFactorCode.trim()}>
              {submitting ? 'Verificando…' : 'Confirmar'}
            </Button>
            <button
              type="button"
              onClick={() => {
                setChallengeToken(null);
                setTwoFactorCode('');
              }}
              className="mt-3 w-full text-center text-textSecondary text-[12.5px] font-semibold bg-transparent border-none cursor-pointer"
            >
              Voltar
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen flex items-center justify-center bg-bg p-6">
      <div className="w-full max-w-[420px] bg-white border border-border rounded-2xl p-9">
        <div className="flex items-center gap-2.5 mb-7">
          <Logo />
        </div>

        <div className="flex gap-1 mb-6 p-1 rounded-lg bg-bg w-fit">
          <button
            type="button"
            onClick={() => setMode('login')}
            className="px-4 py-2 rounded-md text-[13px] font-bold cursor-pointer"
            style={{ background: mode === 'login' ? '#fff' : 'transparent', color: mode === 'login' ? '#0B1F3A' : '#5B6472' }}
          >
            Entrar
          </button>
          <button
            type="button"
            onClick={() => setMode('register')}
            className="px-4 py-2 rounded-md text-[13px] font-bold cursor-pointer"
            style={{ background: mode === 'register' ? '#fff' : 'transparent', color: mode === 'register' ? '#0B1F3A' : '#5B6472' }}
          >
            Criar conta
          </button>
        </div>

        {mode === 'login' ? (
          <form onSubmit={handleLogin}>
            <div className="text-xl font-extrabold mb-1">Entrar na plataforma</div>
            <div className="text-textSecondary text-[13.5px] mb-6">Use uma das contas de demonstração ou a sua conta cadastrada</div>
            <div className="flex flex-col gap-3.5 mb-5">
              <Field label="E-mail">
                <Input type="email" required autoComplete="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} placeholder="voce@empresa.com.br" />
              </Field>
              <Field label="Senha">
                <Input type="password" required autoComplete="current-password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} placeholder="••••••••" />
              </Field>
            </div>
            {authError && <div className="mb-4 px-3.5 py-3 rounded-lg bg-redBg text-red text-[13px] font-semibold">{authError}</div>}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Entrando…' : 'Entrar'}
            </Button>
            <div className="mt-5 p-3.5 rounded-lg bg-bg text-[12px] text-textSecondary leading-relaxed">
              <b>Contas de demonstração</b> (senha <code>demo1234</code>):<br />
              investidor@lastro.demo · cedente@lastro.demo · sacado@lastro.demo · seguradora@lastro.demo
            </div>
          </form>
        ) : (
          <form onSubmit={handleRegister}>
            <div className="text-xl font-extrabold mb-1">Criar conta</div>
            <div className="text-textSecondary text-[13.5px] mb-6">Escolha como você quer acessar a plataforma</div>

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
                    style={{ border: `2px solid ${selected ? '#1E5EFF' : '#E4E8EE'}`, background: selected ? '#EEF3FF' : '#fff' }}
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
                      style={{ borderColor: insurerKey === ins.key ? '#1E5EFF' : '#E4E8EE', background: insurerKey === ins.key ? '#EEF3FF' : '#fff' }}
                    >
                      {ins.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-3.5 mb-5">
              <Field label="Seu nome">
                <Input required value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Marina Costa" />
              </Field>
              <Field label="Nome da empresa">
                <Input required value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Sua empresa Ltda" />
              </Field>
              <Field label="E-mail">
                <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@empresa.com.br" />
              </Field>
              <Field label="Senha">
                <Input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="mínimo 6 caracteres" />
              </Field>
            </div>

            {authError && <div className="mb-4 px-3.5 py-3 rounded-lg bg-redBg text-red text-[13px] font-semibold">{authError}</div>}
            <Button type="submit" className="w-full" disabled={!role || (role === 'seguradora' && !insurerKey) || submitting}>
              {submitting ? 'Criando conta…' : 'Criar conta e entrar'}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
