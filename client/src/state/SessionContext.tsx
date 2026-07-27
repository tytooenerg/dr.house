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
}

interface SessionContextValue {
  user: SessionUser | null;
  loading: boolean;
  authError: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (input: { nome: string; email: string; password: string; companyName: string; role: Role; insurerKey?: string; referralCode?: string }) => Promise<void>;
  logout: () => void;
  submitKyb: (form: { cnpj: string; tipo: string; pl: string }) => Promise<void>;
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
      const data = await api.post<{ token: string; refreshToken: string; user: SessionUser }>('/auth/login', { email, password });
      setSessionTokens(data.token, data.refreshToken);
      setUser(data.user);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Não foi possível entrar.');
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

  const value: SessionContextValue = { user, loading, authError, login, register, logout, submitKyb, completeOnboarding, refresh };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
