import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { NavIcon } from '../components/NavIcon';
import { GROUP_LABELS, NAV_ITEMS } from '../data/navConfig';
import { useSession } from '../state/SessionContext';
import { useIsMobile } from '../lib/useIsMobile';

const GROUPS: ('operacoes' | 'analise' | 'plataforma')[] = ['operacoes', 'analise', 'plataforma'];

export function Sidebar() {
  const { user, logout } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  if (!user) return null;
  const allowed = new Set(user.navTabs);
  const initials = user.nome
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const handleLogout = () => {
    logout();
    navigate('/', { replace: true });
  };

  return (
    <nav
      aria-label="Navegação principal"
      className="bg-navy flex flex-col gap-8 flex-shrink-0 py-7 px-[18px]"
      style={{ width: isMobile ? '100%' : 248, maxHeight: isMobile ? 260 : undefined, overflowY: 'auto' }}
    >
      <Link to="/developers" className="flex items-center gap-2.5 px-2">
        <Logo dark />
      </Link>

      <div className="flex items-start gap-2 px-3 py-2.5 rounded-[10px]" style={{ background: 'rgba(30,94,255,0.14)', border: '1px solid rgba(30,94,255,0.35)' }}>
        <span className="rounded-full mt-1 flex-shrink-0" style={{ width: 7, height: 7, background: '#4C8CFF' }} />
        <div>
          <div className="text-white text-xs font-bold leading-snug">Conforme Duplicata Escritural</div>
          <div className="text-[#9FB3D6] text-[11px] mt-0.5 leading-snug">Registro via CERC · B3 · Núclea — Res. BCB nº 339/2023</div>
        </div>
      </div>

      <div className="flex flex-col gap-1 overflow-y-auto">
        {GROUPS.map((group) => {
          const items = NAV_ITEMS.filter((i) => i.group === group && allowed.has(i.key));
          if (items.length === 0) return null;
          const isOpen = !collapsed[group];
          return (
            <div key={group}>
              <button
                type="button"
                aria-expanded={isOpen}
                className="flex items-center justify-between px-3 pt-3 pb-0.5 border-none bg-transparent cursor-pointer w-full"
                onClick={() => setCollapsed((c) => ({ ...c, [group]: !c[group] }))}
              >
                <span className="text-[10.5px] font-bold text-[#5C6B87] uppercase tracking-wider">{GROUP_LABELS[group]}</span>
                <span className="text-[9px] text-[#5C6B87]" aria-hidden="true">
                  {isOpen ? '▾' : '▸'}
                </span>
              </button>
              {isOpen &&
                items.map((item) => {
                  const active = location.pathname === item.path;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      aria-current={active ? 'page' : undefined}
                      onClick={() => navigate(item.path)}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg border-none cursor-pointer text-left text-sm font-semibold w-full mt-0.5 transition-colors"
                      style={{ background: active ? '#1E5EFF' : 'transparent', color: active ? '#fff' : '#B8C2D4' }}
                    >
                      <NavIcon tab={item.key} />
                      {item.label}
                    </button>
                  );
                })}
            </div>
          );
        })}
      </div>

      <div className="mt-auto flex items-center gap-2.5 p-3 rounded-[10px]" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div className="w-[34px] h-[34px] rounded-full bg-blue text-white flex items-center justify-center font-bold text-[13px]">{initials}</div>
        <div className="flex-1 min-w-0">
          <div className="text-white text-[13px] font-semibold truncate">{user.nome}</div>
          <div className="text-[#8B97AC] text-[11.5px]">{user.sessionLabel}{user.isTeamMember ? ' · somente leitura' : ''}</div>
        </div>
        <button type="button" className="bg-transparent border-none text-[#8B97AC] text-[11.5px] font-bold cursor-pointer" onClick={handleLogout}>
          Sair
        </button>
      </div>
    </nav>
  );
}
