import { useState } from 'react';
import { PageHeader } from '../../components/ui/Card';
import { useLang } from '../../lib/i18n';
import { KybPanel } from './admin/KybPanel';
import { DisputasPanel } from './admin/DisputasPanel';
import { CompliancePanel } from './admin/CompliancePanel';
import { JuridicoPanel } from './admin/JuridicoPanel';
import { IaUsagePanel } from './admin/IaUsagePanel';
import { AgentesIaPanel } from './admin/AgentesIaPanel';
import { FeatureFlagsPanel } from './admin/FeatureFlagsPanel';
import { ReconciliacaoPanel } from './admin/ReconciliacaoPanel';
import { AuditoresPanel } from './admin/AuditoresPanel';
import { AuditTrailPanel } from './admin/AuditTrailPanel';
import { TedPendentesPanel } from './admin/TedPendentesPanel';
import { BackupsPanel } from './admin/BackupsPanel';
import { AddonRevenuePanel } from './admin/AddonRevenuePanel';
import { DailyBriefingCard } from './admin/DailyBriefingCard';
import { AdvertisementsPanel } from './admin/AdvertisementsPanel';
import { ConformidadeEscrituralPanel } from './admin/ConformidadeEscrituralPanel';

// This page used to be ~1900 lines with every tab's state, data-loading and JSX inlined —
// each tab is now its own panel component under admin/, following the pattern already set
// by ReconciliacaoPanel/AgentesIaPanel/FeatureFlagsPanel/AuditoresPanel: self-contained,
// fetches its own data on mount. That's a deliberate behavior change from before (every
// tab's data used to load eagerly on page mount regardless of which tab was active) to
// lazy-per-tab, matching how those four panels already behaved — fewer API calls on a
// typical visit, at the cost of a tab's data no longer being pre-warmed before you click it.
//
// The KYB/disputas/compliance tab-count badges are the one place a fully independent panel
// still needs to hand something back up — each accepts an optional onCount callback it
// fires once its own list loads, so the badge stays live without the parent owning the list.
type Tab = 'kyb' | 'disputas' | 'compliance' | 'juridico' | 'ia' | 'agentes' | 'reconciliacao' | 'flags' | 'auditoria' | 'publicidade' | 'conformidade';

export function AdminPage() {
  const { t } = useLang();
  const [tab, setTab] = useState<Tab>('kyb');
  const [kybCount, setKybCount] = useState(0);
  const [disputasCount, setDisputasCount] = useState(0);
  const [complianceCount, setComplianceCount] = useState(0);
  const [advertisementsCount, setAdvertisementsCount] = useState(0);

  return (
    <div>
      <PageHeader title={t('admin.title', 'Back-office')} subtitle={t('admin.subtitle', 'Aprovação de credenciamento, arbitragem de disputas e trilha de auditoria da plataforma')} />

      <DailyBriefingCard onNavigate={(t) => setTab(t as Tab)} />

      <div className="flex gap-1 mb-5 p-1 rounded-lg bg-bg w-fit flex-wrap">
        {([
          ['kyb', `${t('admin.tab.kyb', 'Fila de KYB')} (${kybCount})`],
          ['disputas', `${t('admin.tab.disputas', 'Disputas')} (${disputasCount})`],
          ['compliance', `${t('admin.tab.compliance', 'Compliance')} (${complianceCount})`],
          ['juridico', t('admin.tab.juridico', 'Jurídico')],
          ['ia', t('admin.tab.ia', 'Uso de IA')],
          ['agentes', t('admin.tab.agentes', 'Agentes IA')],
          ['reconciliacao', t('admin.tab.reconciliacao', 'Reconciliação')],
          ['conformidade', t('admin.tab.conformidade', 'Conformidade Escritural')],
          ['flags', t('admin.tab.flags', 'Feature flags')],
          ['auditoria', t('admin.tab.auditoria', 'Auditoria')],
          ['publicidade', `${t('admin.tab.publicidade', 'Publicidade')} (${advertisementsCount})`],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className="px-4 py-2 rounded-md text-[13px] font-bold cursor-pointer"
            style={{ background: tab === key ? '#fff' : 'transparent', color: tab === key ? '#0B1F3A' : '#5B6472' }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'kyb' && <KybPanel onCount={setKybCount} />}
      {tab === 'disputas' && <DisputasPanel onCount={setDisputasCount} />}
      {tab === 'compliance' && <CompliancePanel onCount={setComplianceCount} />}
      {tab === 'juridico' && <JuridicoPanel />}
      {tab === 'ia' && <IaUsagePanel />}
      {tab === 'agentes' && <AgentesIaPanel />}
      {tab === 'reconciliacao' && <ReconciliacaoPanel />}
      {tab === 'conformidade' && <ConformidadeEscrituralPanel />}
      {tab === 'flags' && <FeatureFlagsPanel />}
      {tab === 'publicidade' && <AdvertisementsPanel onCount={setAdvertisementsCount} />}
      {tab === 'auditoria' && (
        <>
          <AuditTrailPanel />
          <AuditoresPanel />
          <TedPendentesPanel />
          <BackupsPanel />
          <AddonRevenuePanel />
        </>
      )}
    </div>
  );
}
