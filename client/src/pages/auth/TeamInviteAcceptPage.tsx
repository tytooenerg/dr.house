import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Logo } from '../../components/Logo';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Input';
import { useSession } from '../../state/SessionContext';
import { DEFAULT_TAB_BY_ROLE, NAV_ITEMS } from '../../data/navConfig';
import { Notice } from '../../components/ui/Notice';

export function TeamInviteAcceptPage() {
  const { user, acceptTeamInvite, authError } = useSession();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [nome, setNome] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user) return;
    const tab = DEFAULT_TAB_BY_ROLE[user.role];
    const item = NAV_ITEMS.find((i) => i.key === tab);
    navigate(item?.path || '/app/dashboard', { replace: true });
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await acceptTeamInvite({ token, nome: nome.trim() || undefined, password });
    } catch {
      // authError is surfaced below
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <div className="w-full min-h-screen flex items-center justify-center bg-bg p-6">
        <div className="w-full max-w-[420px] bg-white border border-border rounded-2xl p-9 text-center">
          <div className="text-xl font-extrabold mb-2">Link de convite inválido</div>
          <div className="text-textSecondary text-[13px]">O link está incompleto. Peça um novo convite a quem te convidou.</div>
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
        <div className="text-xl font-extrabold mb-1">Aceitar convite de equipe</div>
        <div className="text-textSecondary text-[13px] mb-6">
          Crie sua senha para acessar a conta com permissão de leitura em Dashboard, Minhas Duplicatas, Histórico e Receita.
        </div>
        <form onSubmit={handleSubmit}>
          <div className="flex flex-col gap-3.5 mb-5">
            <Field label="Seu nome (opcional, pode ajustar)">
              <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Seu nome completo" />
            </Field>
            <Field label="Crie uma senha">
              <Input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="mínimo 6 caracteres" />
            </Field>
          </div>
          {authError && <Notice variant="danger" className="mb-4">{authError}</Notice>}
          <Button type="submit" className="w-full" disabled={submitting || password.length < 6}>
            {submitting ? 'Entrando…' : 'Aceitar convite e entrar'}
          </Button>
        </form>
      </div>
    </div>
  );
}
