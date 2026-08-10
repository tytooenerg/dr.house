import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

// Real, functional i18n — not a fake "supports English" toggle. Scope is honest, not
// exhaustive: the public marketing chrome (nav/footer), the app's own navigation (sidebar
// labels), and now the static chrome of the two highest-traffic in-app screens (Dashboard,
// Marketplace — headers, column labels, buttons, static hints) are genuinely bilingual;
// most other in-app page bodies and forms still stay PT-BR, and so does every piece of
// *data* that comes from the server (sacado names, offer amounts, rating labels, bid
// activity) even on the two covered pages — translating the platform's actual business
// data isn't in scope, only the surrounding UI chrome around it. Every key present here has
// a real translation on both sides; t() falls back to the caller-supplied PT default for
// anything not yet covered, so nothing ever renders a raw translation key.
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

    // Dashboard page (static chrome only — KPI/chart data itself stays server-driven PT-BR)
    'dashboard.title': 'Overview',
    'dashboard.subtitle': 'Summary of your activity on the platform',
    'dashboard.volumeChart': 'Volume advanced by month',
    'dashboard.ratingChart': 'Portfolio by rating',
    'dashboard.operacoes': 'operations',

    // Marketplace page (static chrome only — offers, amounts, sacado/cedente names,
    // ratings and bid activity all come from the server and stay PT-BR)
    'marketplace.title': 'Receivables Marketplace',
    'marketplace.subtitle': 'Offers available for advancing — buyers and originators',
    'marketplace.liveUpdates': 'Live updates',
    'marketplace.connecting': 'Connecting…',
    'marketplace.searchPlaceholder': 'Search by debtor or originator',
    'marketplace.sortRate': 'Sort: best rate',
    'marketplace.sortScore': 'Sort: highest score',
    'marketplace.sortValue': 'Sort: highest value',
    'marketplace.sortDeadline': 'Sort: auction closing',
    'marketplace.colSacado': 'Debtor',
    'marketplace.colCedente': 'Originator',
    'marketplace.colValor': 'Amount',
    'marketplace.colDesagio': 'Rate',
    'marketplace.colVencimento': 'Due date',
    'marketplace.colAction': 'Score / Acceptance / Action',
    'marketplace.closeAuction': 'Close auction',
    'marketplace.viewAuction': 'View auction',
    'marketplace.buying': 'Buying…',
    'marketplace.swap': 'Swap',
    'marketplace.noInsurance': 'No insurance coverage',
    'marketplace.insured': 'Insured ✓',
    'marketplace.getInsurance': 'Get insurance',
    'marketplace.insuranceHint': 'Default protection available — compare insurers',
    'marketplace.liveQuotesHint': 'Real-time quotes — each insurer prices this risk differently',
    'marketplace.bestQuote': 'Best quote',
    'marketplace.fractionalize': 'Fractionalize',
    'marketplace.fullyAllocated': 'Fully allocated.',
    'marketplace.buyTokens': 'Buy tokens',
    'marketplace.tokenQtyPlaceholder': 'number of tokens',
    'marketplace.emptyTitle': 'No offers found',
    'marketplace.emptyHint': 'Try searching for a different debtor or originator',
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
