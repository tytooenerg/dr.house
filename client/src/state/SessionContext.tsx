import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../lib/api';

export type Role = 'investidor' | 'cedente' | 'sacado';

export interface OnboardingStep {
  title: string;
  body: string;
}

export interface SessionData {
  isLoggedIn: boolean;
  pickedRole: Role | null;
  userRole: Role | null;
  showKyb: boolean;
  kybStep: number;
  kybDone: boolean;
  kybForm: { cnpj: string; tipo: string; pl: string };
  kybTipoOptions: string[];
  showOnboarding: boolean;
  onboardingStep: number;
  onboardingSteps: OnboardingStep[];
  onboardingCurrent: OnboardingStep;
  onboardingIsLast: boolean;
  sessionLabel: string;
  navTabs: string[];
  userName: string;
}

interface SessionContextValue {
  session: SessionData | null;
  loading: boolean;
  refresh: () => Promise<void>;
  selectRole: (role: Role) => Promise<void>;
  enter: () => Promise<void>;
  updateKyb: (field: 'cnpj' | 'tipo' | 'pl', value: string) => Promise<void>;
  kybNext: () => Promise<void>;
  kybBack: () => Promise<void>;
  onboardingNext: () => Promise<void>;
  onboardingSkip: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const data = await api.get<SessionData>('/session');
    setSession(data);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const value: SessionContextValue = {
    session,
    loading,
    refresh,
    selectRole: async (role) => setSession(await api.post('/session/role', { role })),
    enter: async () => setSession(await api.post('/session/enter')),
    updateKyb: async (field, value) => setSession(await api.post('/session/kyb', { field, value })),
    kybNext: async () => setSession(await api.post('/session/kyb/next')),
    kybBack: async () => setSession(await api.post('/session/kyb/back')),
    onboardingNext: async () => setSession(await api.post('/session/onboarding/next')),
    onboardingSkip: async () => setSession(await api.post('/session/onboarding/skip')),
    logout: async () => setSession(await api.post('/session/logout')),
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
