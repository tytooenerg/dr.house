import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Logo } from '../../components/Logo';
import { Button } from '../../components/ui/Button';
import { useSession } from '../../state/SessionContext';
import { DEFAULT_TAB_BY_ROLE, NAV_ITEMS } from '../../data/navConfig';
import type { Role } from '../../state/SessionContext';
import { KybModal } from './KybModal';

const ROLES: { key: Role; title: string; desc: string; shape: 'circle' | 'square' | 'diamond' }[] = [
  { key: 'investidor', title: 'Investidor / Financiador', desc: 'Comprar duplicatas, gerir carteira e risco', shape: 'circle' },
  { key: 'cedente', title: 'Empresa (cedente)', desc: 'Emitir e antecipar suas duplicatas', shape: 'square' },
  { key: 'sacado', title: 'Empresa (sacado)', desc: 'Confirmar ou contestar duplicatas recebidas', shape: 'diamond' },
];

function RoleShape({ shape }: { shape: 'circle' | 'square' | 'diamond' }) {
  const style: React.CSSProperties = { width: 12, height: 12, border: '2px solid #1E5EFF' };
  if (shape === 'circle') style.borderRadius = '50%';
  if (shape === 'diamond') style.transform = 'rotate(45deg)';
  return <div style={style} />;
}

export function LoginPage() {
  const { session, loading, selectRole, enter } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!session?.isLoggedIn) return;
    const tab = DEFAULT_TAB_BY_ROLE[session.userRole || 'investidor'];
    const item = NAV_ITEMS.find((i) => i.key === tab);
    navigate(item?.path || '/app/dashboard', { replace: true });
  }, [session, navigate]);

  if (loading || !session) return null;

  const handleEnter = async () => {
    await enter();
  };

  return (
    <div className="w-full min-h-screen flex items-center justify-center bg-bg p-6">
      <div className="w-full max-w-[420px] bg-white border border-border rounded-2xl p-9">
        <div className="flex items-center gap-2.5 mb-7">
          <Logo />
        </div>
        <div className="text-xl font-extrabold mb-1">Entrar na plataforma</div>
        <div className="text-textSecondary text-[13.5px] mb-6">Escolha como você quer acessar</div>

        <div className="flex flex-col gap-2.5 mb-5">
          {ROLES.map((r) => {
            const selected = session.pickedRole === r.key;
            return (
              <button
                key={r.key}
                type="button"
                onClick={() => selectRole(r.key)}
                className="flex items-center gap-3 px-4 py-3.5 rounded-[10px] cursor-pointer text-left transition-colors"
                style={{ border: `2px solid ${selected ? '#1E5EFF' : '#E4E8EE'}`, background: selected ? '#EEF3FF' : '#fff' }}
              >
                <div className="w-[34px] h-[34px] rounded-lg bg-chip flex items-center justify-center flex-shrink-0">
                  <RoleShape shape={r.shape} />
                </div>
                <div>
                  <div className="font-bold text-sm">{r.title}</div>
                  <div className="text-textSecondary text-xs mt-0.5">{r.desc}</div>
                </div>
              </button>
            );
          })}
        </div>

        <Button className="w-full" disabled={!session.pickedRole} onClick={handleEnter}>
          Entrar
        </Button>
      </div>
      {session.showKyb && <KybModal />}
    </div>
  );
}
