import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { X } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { AiChat } from './AiChat';
import { useSession } from '../state/SessionContext';
import { useIsMobile } from '../lib/useIsMobile';
import { OnboardingModal } from '../pages/auth/OnboardingModal';
import { ErrorBoundary } from '../components/ErrorBoundary';

export function AppShell() {
  const { user, loading } = useSession();
  const isMobile = useIsMobile();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // Drawer fecha ao navegar, ao voltar pro desktop e com Esc; trava o scroll do fundo enquanto
  // está aberto (senão a página rola por baixo do menu no celular).
  useEffect(() => setMenuOpen(false), [location.pathname]);
  useEffect(() => {
    if (!isMobile) setMenuOpen(false);
  }, [isMobile]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.needsKyb) return <Navigate to="/login" replace />;

  return (
    <div className="flex min-h-screen w-full bg-bg text-navy">
      {!isMobile && (
        <aside className="sticky top-0 h-screen flex-shrink-0">
          <Sidebar />
        </aside>
      )}

      {isMobile && menuOpen && (
        <div className="fixed inset-0 z-[70] flex">
          <div className="absolute inset-0 bg-navy/60" onClick={() => setMenuOpen(false)} aria-hidden="true" />
          <div role="dialog" aria-modal="true" aria-label="Menu" className="relative h-full max-w-[85vw] shadow-modal">
            <Sidebar onNavigate={() => setMenuOpen(false)} />
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              aria-label="Fechar menu"
              className="absolute top-4 right-3 w-8 h-8 rounded-md bg-white/10 text-white border-none cursor-pointer flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar onMenu={isMobile ? () => setMenuOpen(true) : undefined} />
        <main className="flex-1 w-full" style={{ padding: isMobile ? '20px 16px' : '28px 32px', maxWidth: 1280 }}>
          {user.kybPending && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-amberBg text-amber text-[13px] font-semibold">
              Seu credenciamento institucional está em análise (até 2 dias úteis) — você pode explorar o marketplace, mas ainda não pode dar lances.
            </div>
          )}
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      <AiChat />
      {user.showOnboarding && <OnboardingModal />}
    </div>
  );
}
