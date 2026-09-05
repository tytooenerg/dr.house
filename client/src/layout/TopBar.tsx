import { useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { Logo } from '../components/Logo';
import { NotificationBell } from './NotificationBell';
import { findNavItem, GROUP_LABELS } from '../data/navConfig';
import { useLang } from '../lib/i18n';

// Cabeçalho fixo da área logada. Antes não havia nenhum: o sino de notificações flutuava
// solto em `position: fixed` por cima do conteúdo e, no celular, o menu inteiro ficava
// empilhado acima da página. Aqui ficam o botão do menu (só mobile), um breadcrumb
// "Grupo / Página" pra situar o usuário e o sino. O título grande continua sendo o
// PageHeader de cada página — o breadcrumb é contexto, não repetição.
export function TopBar({ onMenu }: { onMenu?: () => void }) {
  const location = useLocation();
  const { t } = useLang();
  const item = findNavItem(location.pathname);
  const groupLabel = item && item.group !== 'inicio' ? t(`group.${item.group}`, GROUP_LABELS[item.group]) : null;

  return (
    <header className="sticky top-0 z-40 flex items-center gap-3 h-14 px-4 md:px-8 bg-bg/90 backdrop-blur border-b border-hairline">
      {onMenu && (
        <button
          type="button"
          onClick={onMenu}
          aria-label="Abrir menu"
          className="w-9 h-9 -ml-1 rounded-lg border border-border bg-white cursor-pointer flex items-center justify-center text-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue"
        >
          <Menu size={18} aria-hidden="true" />
        </button>
      )}
      {onMenu && <Logo size={22} />}

      {item && (
        <nav aria-label="Localização" className="min-w-0 flex items-center gap-1.5 text-[12.5px] text-textSecondary">
          {groupLabel && (
            <>
              <span className="hidden sm:inline">{groupLabel}</span>
              <span className="hidden sm:inline text-textMuted" aria-hidden="true">
                /
              </span>
            </>
          )}
          <span className="font-semibold text-navy truncate" aria-current="page">
            {t(`app.${item.key}`, item.label)}
          </span>
        </nav>
      )}

      <div className="ml-auto flex items-center gap-2">
        <NotificationBell />
      </div>
    </header>
  );
}
