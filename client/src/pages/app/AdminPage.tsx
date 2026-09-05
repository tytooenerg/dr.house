import { lazy, Suspense, useState, type LazyExoticComponent, type ComponentType } from 'react';
import { Navigate, NavLink, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/ui/Card';
import { PageSkeleton } from '../../components/ui/Skeleton';
import { useLang } from '../../lib/i18n';
import { DailyBriefingCard } from './admin/DailyBriefingCard';

// Cada aba do back-office é uma sub-rota real (/app/admin/kyb, /app/admin/disputas, ...) e um
// chunk próprio via lazy(). Antes as 12 abas eram useState + 17 imports estáticos: o chunk do
// AdminPage era o maior do app (~88KB, 4x o segundo), tudo baixado pra ver uma fila vazia, e
// nenhuma aba tinha URL — não dava pra compartilhar "olha a reconciliação" nem usar o botão
// voltar. A aba "auditoria" segue empilhando seus 5 painéis, mas agora só quando aberta.
//
// Os contadores dos badges (KYB/disputas/compliance/publicidade) continuam vindo do próprio
// painel via onCount quando ele monta — mesma relação de antes, sem o pai dono da lista.
const TABS = ['kyb', 'disputas', 'compliance', 'juridico', 'ia', 'agentes', 'reconciliacao', 'conformidade', 'confirming', 'flags', 'auditoria', 'publicidade'] as const;
type Tab = (typeof TABS)[number];
const DEFAULT_TAB: Tab = 'kyb';

function isTab(v: string | undefined): v is Tab {
  return TABS.includes(v as Tab);
}

type CountPanel = ComponentType<{ onCount?: (n: number) => void }>;
const KybPanel = lazy(() => import('./admin/KybPanel').then((m) => ({ default: m.KybPanel as CountPanel })));
const DisputasPanel = lazy(() => import('./admin/DisputasPanel').then((m) => ({ default: m.DisputasPanel as CountPanel })));
const CompliancePanel = lazy(() => import('./admin/CompliancePanel').then((m) => ({ default: m.CompliancePanel as CountPanel })));
const AdvertisementsPanel = lazy(() => import('./admin/AdvertisementsPanel').then((m) => ({ default: m.AdvertisementsPanel as CountPanel })));
const PLAIN_PANELS: Record<Exclude<Tab, 'kyb' | 'disputas' | 'compliance' | 'publicidade' | 'auditoria'>, LazyExoticComponent<ComponentType>> = {
  juridico: lazy(() => import('./admin/JuridicoPanel').then((m) => ({ default: m.JuridicoPanel }))),
  ia: lazy(() => import('./admin/IaUsagePanel').then((m) => ({ default: m.IaUsagePanel }))),
  agentes: lazy(() => import('./admin/AgentesIaPanel').then((m) => ({ default: m.AgentesIaPanel }))),
  reconciliacao: lazy(() => import('./admin/ReconciliacaoPanel').then((m) => ({ default: m.ReconciliacaoPanel }))),
  conformidade: lazy(() => import('./admin/ConformidadeEscrituralPanel').then((m) => ({ default: m.ConformidadeEscrituralPanel }))),
  confirming: lazy(() => import('./admin/ConfirmingAdminPanel').then((m) => ({ default: m.ConfirmingAdminPanel }))),
  flags: lazy(() => import('./admin/FeatureFlagsPanel').then((m) => ({ default: m.FeatureFlagsPanel }))),
};
const AuditTrailPanel = lazy(() => import('./admin/AuditTrailPanel').then((m) => ({ default: m.AuditTrailPanel })));
const AuditoresPanel = lazy(() => import('./admin/AuditoresPanel').then((m) => ({ default: m.AuditoresPanel })));
const TedPendentesPanel = lazy(() => import('./admin/TedPendentesPanel').then((m) => ({ default: m.TedPendentesPanel })));
const BackupsPanel = lazy(() => import('./admin/BackupsPanel').then((m) => ({ default: m.BackupsPanel })));
const AddonRevenuePanel = lazy(() => import('./admin/AddonRevenuePanel').then((m) => ({ default: m.AddonRevenuePanel })));

export function AdminPage() {
  const { t } = useLang();
  const navigate = useNavigate();
  const { tab: tabParam } = useParams<{ tab?: string }>();
  const [kybCount, setKybCount] = useState(0);
  const [disputasCount, setDisputasCount] = useState(0);
  const [complianceCount, setComplianceCount] = useState(0);
  const [advertisementsCount, setAdvertisementsCount] = useState(0);

  // /app/admin (sem aba) mostra a fila de KYB sem redirecionar — a URL curta continua válida
  // (é pra onde o login do admin cai). Só uma aba inexistente na URL volta pra padrão.
  if (tabParam !== undefined && !isTab(tabParam)) return <Navigate to={`/app/admin/${DEFAULT_TAB}`} replace />;
  const tab: Tab = isTab(tabParam) ? tabParam : DEFAULT_TAB;

  const tabs: [Tab, string][] = [
    ['kyb', `${t('admin.tab.kyb', 'Fila de KYB')} (${kybCount})`],
    ['disputas', `${t('admin.tab.disputas', 'Disputas')} (${disputasCount})`],
    ['compliance', `${t('admin.tab.compliance', 'Compliance')} (${complianceCount})`],
    ['juridico', t('admin.tab.juridico', 'Jurídico')],
    ['ia', t('admin.tab.ia', 'Uso de IA')],
    ['agentes', t('admin.tab.agentes', 'Agentes IA')],
    ['reconciliacao', t('admin.tab.reconciliacao', 'Reconciliação')],
    ['conformidade', t('admin.tab.conformidade', 'Conformidade Escritural')],
    ['confirming', t('admin.tab.confirming', 'Programa Confirming')],
    ['flags', t('admin.tab.flags', 'Feature flags')],
    ['auditoria', t('admin.tab.auditoria', 'Auditoria')],
    ['publicidade', `${t('admin.tab.publicidade', 'Publicidade')} (${advertisementsCount})`],
  ];

  let panel: React.ReactNode;
  if (tab === 'kyb') panel = <KybPanel onCount={setKybCount} />;
  else if (tab === 'disputas') panel = <DisputasPanel onCount={setDisputasCount} />;
  else if (tab === 'compliance') panel = <CompliancePanel onCount={setComplianceCount} />;
  else if (tab === 'publicidade') panel = <AdvertisementsPanel onCount={setAdvertisementsCount} />;
  else if (tab === 'auditoria')
    panel = (
      <>
        <AuditTrailPanel />
        <AuditoresPanel />
        <TedPendentesPanel />
        <BackupsPanel />
        <AddonRevenuePanel />
      </>
    );
  else {
    const Panel = PLAIN_PANELS[tab];
    panel = <Panel />;
  }

  return (
    <div>
      <PageHeader title={t('admin.title', 'Back-office')} subtitle={t('admin.subtitle', 'Aprovação de credenciamento, arbitragem de disputas e trilha de auditoria da plataforma')} />

      <DailyBriefingCard onNavigate={(target) => navigate(`/app/admin/${target}`)} />

      <nav aria-label="Seções do back-office" className="flex gap-1 mb-5 p-1 rounded-lg bg-white border border-border w-fit max-w-full flex-wrap">
        {tabs.map(([key, label]) => (
          <NavLink
            key={key}
            to={`/app/admin/${key}`}
            end
            className={({ isActive }) =>
              `px-3.5 py-2 rounded-md text-[13px] font-bold no-underline whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue ${
                isActive || (key === DEFAULT_TAB && tabParam === undefined) ? 'bg-navy text-white' : 'text-textSecondary hover:bg-bg'
              }`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>

      <Suspense fallback={<PageSkeleton />}>{panel}</Suspense>
    </div>
  );
}
