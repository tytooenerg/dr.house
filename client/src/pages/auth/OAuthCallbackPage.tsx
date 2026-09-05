import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Logo } from '../../components/Logo';
import { useSession } from '../../state/SessionContext';
import { DEFAULT_TAB_BY_ROLE, NAV_ITEMS } from '../../data/navConfig';

// Landing point for the real Google OAuth redirect (see server routes/auth.ts
// GET /auth/google/callback) — the server already exchanged the code and issued real
// session tokens (or linked an existing account); this page just adopts them into the
// SPA the same way a normal login does, then routes into the app.
export function OAuthCallbackPage() {
  const { user, loginWithTokens } = useSession();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = searchParams.get('token');
    const refreshToken = searchParams.get('refreshToken');
    if (!token || !refreshToken) {
      setError('Link de retorno do Google inválido ou incompleto.');
      return;
    }
    loginWithTokens(token, refreshToken).catch(() => setError('Não foi possível concluir o login com Google.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!user) return;
    const tab = DEFAULT_TAB_BY_ROLE[user.role];
    const item = NAV_ITEMS.find((i) => i.key === tab);
    navigate(item?.path || '/app/dashboard', { replace: true });
  }, [user, navigate]);

  return (
    <div className="w-full min-h-screen flex items-center justify-center bg-bg p-6">
      <div className="w-full max-w-[420px] bg-white border border-border rounded-2xl p-9 text-center">
        <div className="flex items-center justify-center gap-2.5 mb-7">
          <Logo />
        </div>
        {error ? (
          <>
            <div className="text-xl font-extrabold mb-2">Não foi possível entrar</div>
            <div className="text-textSecondary text-[13px]">{error}</div>
          </>
        ) : (
          <div className="text-textSecondary text-[13px]">Entrando com sua conta Google…</div>
        )}
      </div>
    </div>
  );
}
