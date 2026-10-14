import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Logo } from '../../components/Logo';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Input';
import { useSession } from '../../state/SessionContext';
import { DEFAULT_TAB_BY_ROLE, NAV_ITEMS } from '../../data/navConfig';
import { Notice } from '../../components/ui/Notice';

// Reached from the e-mail link POST /auth/forgot-password sends (routes/auth.ts). The
// reset itself can still require 2FA — resetting the password never bypasses it — so this
// mirrors LoginPage's own TOTP challenge step rather than redirecting back through /login,
// which would lose the reset token's one-time use.
export function ResetPasswordPage() {
  const { user, resetPassword, verifyTwoFactor, authError } = useSession();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');

  useEffect(() => {
    if (!user) return;
    const tab = DEFAULT_TAB_BY_ROLE[user.role];
    const item = NAV_ITEMS.find((i) => i.key === tab);
    navigate(item?.path || '/app/dashboard', { replace: true });
  }, [user, navigate]);

  if (!token) {
    return (
      <div className="w-full min-h-screen flex items-center justify-center bg-bg p-6">
        <div className="w-full max-w-[420px] bg-white border border-border rounded-2xl p-9 text-center">
          <div className="text-xl font-extrabold mb-2">Link inválido</div>
          <div className="text-textSecondary text-[13px]">Peça um novo link em "Esqueci minha senha" na tela de login.</div>
        </div>
      </div>
    );
  }

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

  if (challengeToken) {
    return (
      <div className="w-full min-h-screen flex items-center justify-center bg-bg p-6">
        <div className="w-full max-w-[420px] bg-white border border-border rounded-2xl p-9">
          <div className="flex items-center gap-2.5 mb-7">
            <Logo />
          </div>
          <form onSubmit={handleVerifyTwoFactor}>
            <div className="text-xl font-extrabold mb-1">Verificação em duas etapas</div>
            <div className="text-textSecondary text-[13px] mb-6">
              Sua senha foi redefinida. Digite o código de 6 dígitos do seu app autenticador, ou um código de recuperação, pra entrar.
            </div>
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
            {authError && <Notice variant="danger" className="mb-4">{authError}</Notice>}
            <Button type="submit" className="w-full" disabled={submitting || !twoFactorCode.trim()}>
              {submitting ? 'Verificando…' : 'Confirmar'}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  const passwordsMismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6 || passwordsMismatch) return;
    setSubmitting(true);
    try {
      const result = await resetPassword(token, newPassword);
      if (result.twoFactorRequired && result.challengeToken) setChallengeToken(result.challengeToken);
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
        <form onSubmit={handleSubmit}>
          <div className="text-xl font-extrabold mb-1">Defina uma senha nova</div>
          <div className="text-textSecondary text-[13px] mb-6">Escolha uma senha com pelo menos 6 caracteres.</div>
          <div className="flex flex-col gap-3.5 mb-5">
            <Field label="Senha nova">
              <Input
                type="password"
                required
                autoFocus
                minLength={6}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="mínimo 6 caracteres"
              />
            </Field>
            <Field label="Confirme a senha nova">
              <Input
                type="password"
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="repita a senha"
              />
            </Field>
            {passwordsMismatch && <div className="text-red text-[12.5px] font-semibold">As senhas não coincidem.</div>}
          </div>
          {authError && <Notice variant="danger" className="mb-4">{authError}</Notice>}
          <Button type="submit" className="w-full" disabled={submitting || newPassword.length < 6 || passwordsMismatch}>
            {submitting ? 'Redefinindo…' : 'Redefinir senha e entrar'}
          </Button>
        </form>
      </div>
    </div>
  );
}
