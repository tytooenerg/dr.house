import { Link } from 'react-router-dom';
import { Logo } from '../../components/Logo';
import { LanguageToggle } from '../../components/LanguageToggle';
import { useLang } from '../../lib/i18n';

export function PublicNav({ active }: { active?: 'developers' | 'docs' | 'precos' | 'legal' | 'transparencia' | 'status' }) {
  const { t } = useLang();
  return (
    <div className="flex items-center justify-between px-14 py-5 border-b border-hairline">
      <div className="flex items-center gap-9">
        <Link to="/">
          <Logo size={24} />
        </Link>
        <div className="hidden md:flex items-center gap-7 text-sm font-semibold text-slate">
          <Link to="/developers" className={active === 'developers' ? 'text-navy' : 'text-slate'}>
            {t('nav.developers', 'Desenvolvedores')}
          </Link>
          <Link to="/docs" className={active === 'docs' ? 'text-navy' : 'text-slate'}>
            {t('nav.docs', 'Docs')}
          </Link>
          <Link to="/precos" className={active === 'precos' ? 'text-navy' : 'text-slate'}>
            {t('nav.precos', 'Preços')}
          </Link>
          <Link to="/transparencia" className={active === 'transparencia' ? 'text-navy' : 'text-slate'}>
            {t('nav.transparencia', 'Transparência')}
          </Link>
          <Link to="/status" className={active === 'status' ? 'text-navy' : 'text-slate'}>
            {t('nav.status', 'Status')}
          </Link>
          <Link to="/legal" className={active === 'legal' ? 'text-navy' : 'text-slate'}>
            {t('nav.legal', 'Legal')}
          </Link>
        </div>
      </div>
      <div className="flex items-center gap-5 text-sm font-semibold">
        <LanguageToggle />
        <Link to="/login" className="text-slate">
          {t('nav.entrar', 'Entrar')}
        </Link>
        <Link to="/legal#contato" className="px-4.5 py-2.5 rounded-lg bg-navy text-white">
          {t('nav.falarVendas', 'Falar com vendas')}
        </Link>
      </div>
    </div>
  );
}

export function PublicFooter() {
  const { t } = useLang();
  return (
    <div className="px-14 py-8 border-t border-hairline">
      <div className="flex justify-between items-center flex-wrap gap-4">
        <Logo size={20} />
        <div className="flex gap-5 text-[12.5px] text-textSecondary font-semibold">
          <Link to="/legal#termos" className="text-textSecondary">
            {t('footer.termos', 'Termos de uso')}
          </Link>
          <Link to="/legal#privacidade" className="text-textSecondary">
            {t('footer.privacidade', 'Privacidade')}
          </Link>
          <Link to="/status" className="text-textSecondary">
            {t('footer.status', 'Status')}
          </Link>
          <Link to="/legal#contato" className="text-textSecondary">
            {t('footer.contato', 'Contato')}
          </Link>
        </div>
      </div>
      <div className="text-textTertiary text-xs mt-4">
        © 2026 Lastro Tecnologia Ltda. Infraestrutura para duplicatas escriturais. Não somos um banco; operações de crédito são realizadas por instituições financeiras parceiras.
      </div>
    </div>
  );
}
