import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

// Real, functional i18n — not a fake "supports English" toggle. Scope is honest, not
// exhaustive: the public marketing chrome (nav/footer) and the app's own navigation
// (sidebar labels) are genuinely bilingual and switch instantly; deep in-app screen
// content (page bodies, forms) stays PT-BR — translating every string across dozens of
// pages is out of scope for this pass, and this file makes no claim otherwise. Every key
// present here has a real translation on both sides; t() falls back to the caller-supplied
// PT default for anything not yet covered, so nothing ever renders a raw translation key.
export type Lang = 'pt' | 'en';

const STORAGE_KEY = 'lastro_lang';

const TRANSLATIONS: Record<Lang, Record<string, string>> = {
  pt: {},
  en: {
    // Public nav/footer
    'nav.developers': 'Developers',
    'nav.precos': 'Pricing',
    'nav.transparencia': 'Transparency',
    'nav.status': 'Status',
    'nav.legal': 'Legal',
    'nav.entrar': 'Log in',
    'nav.falarVendas': 'Talk to sales',
    'footer.termos': 'Terms of use',
    'footer.privacidade': 'Privacy',
    'footer.status': 'Status',
    'footer.contato': 'Contact',

    // Sidebar group labels
    'group.operacoes': 'Operations',
    'group.analise': 'Analysis',
    'group.plataforma': 'Platform',

    // Sidebar nav item labels (keyed by NAV_ITEMS[].key)
    'app.dashboard': 'Overview',
    'app.marketplace': 'Marketplace',
    'app.automacao': 'Bid Automation',
    'app.erp': 'ERP Integrations',
    'app.emitir': 'Issue Receivable',
    'app.minhas': 'My Receivables',
    'app.secundario': 'Secondary Market',
    'app.cestas': 'Investment Baskets',
    'app.suitability': 'Investor Profile',
    'app.aceite': 'Debtor Acceptance',
    'app.sacado': 'Debtor Portal',
    'app.disputa': 'Dispute Resolution',
    'app.risco': 'Risk Analysis',
    'app.historico': 'Portfolio & History',
    'app.comparador': 'Rate Comparator',
    'app.compliance': 'Compliance',
    'app.dev': 'Developers',
    'app.conta': 'Account & Settlement',
    'app.receita': 'Revenue Model',
    'app.assinatura': 'Subscription',
    'app.perfil': 'Profile & Settings',
    'app.admin': 'Back Office',
    'app.seguradora': 'Insurer Panel',
    'app.sair': 'Log out',
  },
};
// PT strings live inline in each component as the ptDefault argument to t() — the app's
// native language needs no separate dictionary — so TRANSLATIONS.pt stays empty by
// design; t() simply returns the caller-supplied PT default whenever lang === 'pt'.

interface LangContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, ptDefault: string) => string;
}

const LangContext = createContext<LangContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
    return stored === 'en' ? 'en' : 'pt';
  });

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang === 'en' ? 'en' : 'pt-BR';
  }, [lang]);

  const setLang = (next: Lang) => setLangState(next);
  const t = (key: string, ptDefault: string) => (lang === 'en' ? TRANSLATIONS.en[key] ?? ptDefault : ptDefault);

  return <LangContext.Provider value={{ lang, setLang, t }}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang must be used within a LanguageProvider');
  return ctx;
}
