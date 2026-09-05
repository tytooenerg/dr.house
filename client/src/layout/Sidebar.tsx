import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { Logo } from '../components/Logo';
import { NavIcon } from '../components/NavIcon';
import { groupNavItems } from '../data/navConfig';
import { useSession } from '../state/SessionContext';
import { useLang } from '../lib/i18n';
import { LanguageToggle } from '../components/LanguageToggle';

// Sidebar é só o menu: quem decide se ela fica fixa ao lado (desktop) ou dentro de um drawer
// (mobile) é o AppShell. `onNavigate` é chamado a cada clique em item pra o drawer se fechar.
//
// Itens são <NavLink> de verdade, não <button onClick={navigate}> — abre em nova aba com
// botão do meio, aparece como link pra leitor de tela e ganha aria-current="page" sozinho
// (inclusive em sub-rotas: /app/admin/kyb acende "Back-office").
export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useSession();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const { t } = useLang();

  if (!user) return null;
  const sections = groupNavItems(user.navTabs);
  const initials = user.nome
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <nav aria-label="Navegação principal" className="bg-navy flex flex-col h-full w-[248px] py-5 px-3.5 overflow-y-auto">
      <Link to="/developers" className="flex items-center gap-2.5 px-2 mb-5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
        <Logo dark />
      </Link>

      <div className="flex flex-col gap-3 flex-1">
        {sections.map((section) => {
          const isOpen = !collapsed[section.group];
          return (
            <div key={section.group}>
              {section.label && (
                <button
                  type="button"
                  aria-expanded={isOpen}
                  className="flex items-center justify-between px-3 pb-1.5 border-none bg-transparent cursor-pointer w-full rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                  onClick={() => setCollapsed((c) => ({ ...c, [section.group]: !c[section.group] }))}
                >
                  <span className="text-[10.5px] font-bold text-onNavyFaint uppercase tracking-wider">{t(`group.${section.group}`, section.label)}</span>
                  <ChevronDown size={12} className="text-onNavyFaint transition-transform" style={{ transform: isOpen ? 'none' : 'rotate(-90deg)' }} aria-hidden="true" />
                </button>
              )}
              {isOpen && (
                <ul className="list-none m-0 p-0 flex flex-col gap-0.5">
                  {section.items.map((item) => (
                    <li key={item.key}>
                      <NavLink
                        to={item.path}
                        onClick={onNavigate}
                        className={({ isActive }) =>
                          `flex items-center gap-3 px-3 py-[7px] rounded-lg text-[13px] font-semibold no-underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${
                            isActive ? 'bg-blue text-white' : 'text-onNavyDim hover:bg-white/[0.06] hover:text-white'
                          }`
                        }
                      >
                        <NavIcon tab={item.key} />
                        <span className="truncate">{t(`app.${item.key}`, item.label)}</span>
                      </NavLink>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {/* Selo de conformidade: antes era um card grande logo abaixo da logo, empurrando o menu
          pra baixo em todo papel. Continua visível, mas como rodapé discreto. */}
      <div className="mt-6 px-3 text-[10.5px] leading-snug text-onNavyFaint">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-onNavyBright mr-1.5 align-middle" aria-hidden="true" />
        Conforme Duplicata Escritural · Res. BCB nº 339/2023
      </div>

      <div className="mt-3 flex items-center gap-2.5 p-3 rounded-[10px]" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div className="w-[34px] h-[34px] rounded-full bg-blue text-white flex items-center justify-center font-bold text-[13px] flex-shrink-0">{initials}</div>
        <div className="flex-1 min-w-0">
          <div className="text-white text-[13px] font-semibold truncate">{user.nome}</div>
          <div className="text-textTertiary text-[11.5px] truncate">
            {user.sessionLabel}
            {user.isTeamMember ? ' · somente leitura' : ''}
          </div>
        </div>
        <LanguageToggle className="text-textTertiary" />
        <button
          type="button"
          className="bg-transparent border-none text-textTertiary text-[11.5px] font-bold cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          onClick={handleLogout}
        >
          {t('app.sair', 'Sair')}
        </button>
      </div>
    </nav>
  );
}
