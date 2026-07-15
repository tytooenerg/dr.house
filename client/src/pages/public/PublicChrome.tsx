import { Link } from 'react-router-dom';
import { Logo } from '../../components/Logo';

export function PublicNav({ active }: { active?: 'developers' | 'precos' | 'legal' }) {
  return (
    <div className="flex items-center justify-between px-14 py-5 border-b border-hairline">
      <div className="flex items-center gap-9">
        <Link to="/developers">
          <Logo size={24} />
        </Link>
        <div className="hidden md:flex items-center gap-7 text-sm font-semibold text-[#3D4658]">
          <span className={active === 'developers' ? 'text-navy' : ''}>Desenvolvedores</span>
          <Link to="/precos" className={active === 'precos' ? 'text-navy' : 'text-[#3D4658]'}>
            Preços
          </Link>
          <Link to="/legal" className={active === 'legal' ? 'text-navy' : 'text-[#3D4658]'}>
            Legal
          </Link>
        </div>
      </div>
      <div className="flex items-center gap-5 text-sm font-semibold">
        <Link to="/" className="text-[#3D4658]">
          Entrar
        </Link>
        <Link to="/" className="px-4.5 py-2.5 rounded-lg bg-navy text-white">
          Falar com vendas
        </Link>
      </div>
    </div>
  );
}

export function PublicFooter() {
  return (
    <div className="px-14 py-8 border-t border-hairline">
      <div className="flex justify-between items-center flex-wrap gap-4">
        <Logo size={20} />
        <div className="flex gap-5 text-[12.5px] text-textSecondary font-semibold">
          <Link to="/legal#termos" className="text-textSecondary">
            Termos de uso
          </Link>
          <Link to="/legal#privacidade" className="text-textSecondary">
            Privacidade
          </Link>
          <Link to="/legal#status" className="text-textSecondary">
            Status
          </Link>
          <Link to="/legal#contato" className="text-textSecondary">
            Contato
          </Link>
        </div>
      </div>
      <div className="text-textTertiary text-xs mt-4">
        © 2026 Lastro Tecnologia Ltda. Infraestrutura para duplicatas escriturais. Não somos um banco; operações de crédito são realizadas por instituições financeiras parceiras.
      </div>
    </div>
  );
}
