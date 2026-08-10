import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getRefreshToken, getToken, setSessionTokens, setUnauthorizedHandler } from '../lib/api';

export type Role = 'investidor' | 'cedente' | 'sacado' | 'admin' | 'seguradora';
export type Plan = 'basico' | 'pro' | 'empresarial';

export interface OnboardingStep {
  title: string;
  body: string;
}

export interface SessionUser {
  id: number;
  email: string;
  nome: string;
  telefone: string;
  companyName: string;
  role: Role;
  kybDone: boolean;
  kybForm: { cnpj?: string; tipo?: string; pl?: string };
  kybTipoOptions: string[];
  kybStatus: 'none' | 'pending' | 'approved' | 'rejected';
  kybRejectReason: string;
  needsKyb: boolean;
  kybPending: boolean;
  showOnboarding: boolean;
  onboardingSteps: OnboardingStep[];
  sessionLabel: string;
  navTabs: string[];
  plan: Plan;
  subscriptionStatus: 'none' | 'active' | 'active_demo' | 'canceled' | 'past_due';
  insurerKey: string | null;
  insurerName: string | null;
  isTeamMember: boolean;
}

interface SessionContextValue {
  user: SessionUser | null;
  loading: boolean;
  authError: string | null;
  login: (email: string, password: string) => Promise<{ twoFactorRequired: boolean; challengeToken?: string }>;
  verifyTwoFactor: (challengeToken: string, code: string) => Promise<void>;
  register: (input: { nome: string; email: string; password: string; companyName: string; role: Role; insurerKey?: string; referralCode?: string }) => Promise<void>;
  acceptTeamInvite: (input: { token: string; nome?: string; password: string }) => Promise<void>;
  loginWithTokens: (token: string, refreshToken: string) => Promise<void>;
  completeGoogleSignup: (input: { signupToken: string; companyName: string; role: Role; insurerKey?: string }) => Promise<void>;
  completeSamlSignup: (input: { signupToken: string; companyName: string; role: Role; insurerKey?: string }) => Promise<void>;
  logout: () => void;
  submitKyb: (form: {
    cnpj: string;
    tipo: string;
    pl: string;
    naoResidente?: boolean;
    paisDomicilio?: string;
    taxIdEstrangeiro?: string;
    representanteLegal?: string;
  }) => Promise<void>;
  completeOnboarding: () => Promise<void>;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      return;
    }
    try {
      const data = await api.get<{ user: SessionUser }>('/auth/me');
      setUser(data.user);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    refresh().finally(() => setLoading(false));
    return () => setUnauthorizedHandler(null);
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    setAuthError(null);
    try {
      const data = await api.post<{ token?: string; refreshToken?: string; user?: SessionUser; twoFactorRequired?: boolean; challengeToken?: string }>(
        '/auth/login',
        { email, password }
      );
      if (data.twoFactorRequired) return { twoFactorRequired: true, challengeToken: data.challengeToken };
      setSessionTokens(data.token!, data.refreshToken!);
      setUser(data.user!);
      return { twoFactorRequired: false };
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Não foi possível entrar.');
      throw err;
    }
  }, []);

  const verifyTwoFactor = useCallback(async (challengeToken: string, code: string) => {
    setAuthError(null);
    try {
      const data = await api.post<{ token: string; refreshToken: string; user: SessionUser }>('/auth/2fa/verify-login', { challengeToken, code });
      setSessionTokens(data.token, data.refreshToken);
      setUser(data.user);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Código inválido.');
      throw err;
    }
  }, []);

  const register = useCallback(async (input: { nome: string; email: string; password: string; companyName: string; role: Role; insurerKey?: string; referralCode?: string }) => {
    setAuthError(null);
    try {
      const data = await api.post<{ token: string; refreshToken: string; user: SessionUser }>('/auth/register', input);
      setSessionTokens(data.token, data.refreshToken);
      setUser(data.user);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Não foi possível criar a conta.');
      throw err;
    }
  }, []);

  const acceptTeamInvite = useCallback(async (input: { token: string; nome?: string; password: string }) => {
    setAuthError(null);
    try {
      const data = await api.post<{ token: string; refreshToken: string; user: SessionUser }>('/auth/team-invite/accept', input);
      setSessionTokens(data.token, data.refreshToken);
      setUser(data.user);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Não foi possível aceitar o convite.');
      throw err;
    }
  }, []);

  // Used by the /oauth/callback page after a real Google OAuth redirect round-trip — the
  // server already issued real session tokens (login, or an existing-email account
  // linked); this just adopts them into the SPA the same way login()/register() do.
  const loginWithTokens = useCallback(async (token: string, refreshToken: string) => {
    setSessionTokens(token, refreshToken);
    await refresh();
  }, [refresh]);

  const completeGoogleSignup = useCallback(async (input: { signupToken: string; companyName: string; role: Role; insurerKey?: string }) => {
    setAuthError(null);
    try {
      const data = await api.post<{ token: string; refreshToken: string; user: SessionUser }>('/auth/google/complete-signup', input);
      setSessionTokens(data.token, data.refreshToken);
      setUser(data.user);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Não foi possível concluir o cadastro.');
      throw err;
    }
  }, []);

  const completeSamlSignup = useCallback(async (input: { signupToken: string; companyName: string; role: Role; insurerKey?: string }) => {
    setAuthError(null);
    try {
      const data = await api.post<{ token: string; refreshToken: string; user: SessionUser }>('/auth/saml/complete-signup', input);
      setSessionTokens(data.token, data.refreshToken);
      setUser(data.user);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Não foi possível concluir o cadastro.');
      throw err;
    }
  }, []);

  const logout = useCallback(() => {
    const refreshToken = getRefreshToken();
    api.post('/auth/logout', refreshToken ? { refreshToken } : undefined).catch(() => {});
    setSessionTokens(null, null);
    setUser(null);
  }, []);

  const submitKyb = useCallback(async (form: { cnpj: string; tipo: string; pl: string }) => {
    const data = await api.post<{ user: SessionUser }>('/auth/kyb', form);
    setUser(data.user);
  }, []);

  const completeOnboarding = useCallback(async () => {
    await api.post('/auth/onboarding/complete');
    setUser((u) => (u ? { ...u, showOnboarding: false } : u));
  }, []);

  const value: SessionContextValue = {
    user,
    loading,
    authError,
    login,
    verifyTwoFactor,
    register,
    acceptTeamInvite,
    loginWithTokens,
    completeGoogleSignup,
    completeSamlSignup,
    logout,
    submitKyb,
    completeOnboarding,
    refresh,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
