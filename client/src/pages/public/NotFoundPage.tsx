import { Link } from 'react-router-dom';
import { Logo } from '../../components/Logo';

export function NotFoundPage() {
  return (
    <div className="w-full min-h-screen flex items-center justify-center p-6 bg-bg">
      <div className="text-center max-w-[440px]">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <Logo />
        </div>
        <div className="text-[64px] font-extrabold text-inputBorder tracking-tight mb-2">404</div>
        <div className="text-xl font-extrabold mb-2.5">Esta página não foi encontrada</div>
        <div className="text-textSecondary text-[14.5px] mb-8 leading-relaxed">O link pode estar quebrado ou a página foi movida. Volte para a plataforma ou fale com o suporte.</div>
        <div className="flex gap-2.5 justify-center flex-wrap">
          <Link to="/login" className="px-5 py-3 rounded-lg bg-blue text-white font-bold text-sm">
            Ir para a plataforma
          </Link>
          <Link to="/legal#contato" className="px-5 py-3 rounded-lg bg-white border border-inputBorder text-navy font-bold text-sm">
            Falar com suporte
          </Link>
        </div>
      </div>
    </div>
  );
}
