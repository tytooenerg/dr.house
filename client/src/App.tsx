import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { SessionProvider } from './state/SessionContext';
import { AppShell } from './layout/AppShell';
import { Gate } from './components/Gate';
import { PageSkeleton } from './components/ui/Skeleton';
import { LoginPage } from './pages/auth/LoginPage';

// Every route below LoginPage is lazy-loaded — before this change, the whole app (every
// role's every screen, public marketing pages included) shipped as one 507kB JS chunk on
// first load, even for a visitor who only ever sees the login screen or a single role's
// handful of tabs. `vite build` was already warning about this. LoginPage stays eager since
// it's the one screen almost every real visit hits first; everything else loads on demand,
// keyed by the actual route, with `PageSkeleton` (already used for in-page loading states —
// see DashboardPage) as the one shared Suspense fallback so a lazy chunk load never flashes
// a blank screen.
const TeamInviteAcceptPage = lazy(() => import('./pages/auth/TeamInviteAcceptPage').then((m) => ({ default: m.TeamInviteAcceptPage })));
const OAuthCallbackPage = lazy(() => import('./pages/auth/OAuthCallbackPage').then((m) => ({ default: m.OAuthCallbackPage })));
const CompleteGoogleSignupPage = lazy(() => import('./pages/auth/CompleteGoogleSignupPage').then((m) => ({ default: m.CompleteGoogleSignupPage })));
const CompleteSamlSignupPage = lazy(() => import('./pages/auth/CompleteSamlSignupPage').then((m) => ({ default: m.CompleteSamlSignupPage })));
const DashboardPage = lazy(() => import('./pages/app/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const MarketplacePage = lazy(() => import('./pages/app/MarketplacePage').then((m) => ({ default: m.MarketplacePage })));
const AutomacaoPage = lazy(() => import('./pages/app/AutomacaoPage').then((m) => ({ default: m.AutomacaoPage })));
const ComparadorPage = lazy(() => import('./pages/app/ComparadorPage').then((m) => ({ default: m.ComparadorPage })));
const MinhasPage = lazy(() => import('./pages/app/MinhasPage').then((m) => ({ default: m.MinhasPage })));
const CreditLinePage = lazy(() => import('./pages/app/CreditLinePage').then((m) => ({ default: m.CreditLinePage })));
const ContasPagarPage = lazy(() => import('./pages/app/ContasPagarPage').then((m) => ({ default: m.ContasPagarPage })));
const AiCfoPage = lazy(() => import('./pages/app/AiCfoPage').then((m) => ({ default: m.AiCfoPage })));
const RiscoPage = lazy(() => import('./pages/app/RiscoPage').then((m) => ({ default: m.RiscoPage })));
const HistoricoPage = lazy(() => import('./pages/app/HistoricoPage').then((m) => ({ default: m.HistoricoPage })));
const ErpPage = lazy(() => import('./pages/app/ErpPage').then((m) => ({ default: m.ErpPage })));
const EmitirPage = lazy(() => import('./pages/app/EmitirPage').then((m) => ({ default: m.EmitirPage })));
const CompliancePage = lazy(() => import('./pages/app/CompliancePage').then((m) => ({ default: m.CompliancePage })));
const DevPage = lazy(() => import('./pages/app/DevPage').then((m) => ({ default: m.DevPage })));
const AceitePage = lazy(() => import('./pages/app/AceitePage').then((m) => ({ default: m.AceitePage })));
const SacadoPage = lazy(() => import('./pages/app/SacadoPage').then((m) => ({ default: m.SacadoPage })));
const ConfirmingPage = lazy(() => import('./pages/app/ConfirmingPage').then((m) => ({ default: m.ConfirmingPage })));
const DisputaPage = lazy(() => import('./pages/app/DisputaPage').then((m) => ({ default: m.DisputaPage })));
const PerfilPage = lazy(() => import('./pages/app/PerfilPage').then((m) => ({ default: m.PerfilPage })));
const ContaPage = lazy(() => import('./pages/app/ContaPage').then((m) => ({ default: m.ContaPage })));
const ReceitaPage = lazy(() => import('./pages/app/ReceitaPage').then((m) => ({ default: m.ReceitaPage })));
const AdminPage = lazy(() => import('./pages/app/AdminPage').then((m) => ({ default: m.AdminPage })));
const AssinaturaPage = lazy(() => import('./pages/app/AssinaturaPage').then((m) => ({ default: m.AssinaturaPage })));
const SeguradoraPage = lazy(() => import('./pages/app/SeguradoraPage').then((m) => ({ default: m.SeguradoraPage })));
const AuditorPage = lazy(() => import('./pages/app/AuditorPage').then((m) => ({ default: m.AuditorPage })));
const PublicidadePage = lazy(() => import('./pages/app/PublicidadePage').then((m) => ({ default: m.PublicidadePage })));
const LandingPage = lazy(() => import('./pages/public/LandingPage').then((m) => ({ default: m.LandingPage })));
const DevelopersPage = lazy(() => import('./pages/public/DevelopersPage').then((m) => ({ default: m.DevelopersPage })));
const DocsPage = lazy(() => import('./pages/public/DocsPage').then((m) => ({ default: m.DocsPage })));
const PrecosPage = lazy(() => import('./pages/public/PrecosPage').then((m) => ({ default: m.PrecosPage })));
const LegalPage = lazy(() => import('./pages/public/LegalPage').then((m) => ({ default: m.LegalPage })));
const TransparenciaPage = lazy(() => import('./pages/public/TransparenciaPage').then((m) => ({ default: m.TransparenciaPage })));
const StatusPage = lazy(() => import('./pages/public/StatusPage').then((m) => ({ default: m.StatusPage })));
const EmbedSimuladorPage = lazy(() => import('./pages/public/EmbedSimuladorPage').then((m) => ({ default: m.EmbedSimuladorPage })));
const SecundarioPage = lazy(() => import('./pages/app/SecundarioPage').then((m) => ({ default: m.SecundarioPage })));
const CestasPage = lazy(() => import('./pages/app/CestasPage').then((m) => ({ default: m.CestasPage })));
const SuitabilityPage = lazy(() => import('./pages/app/SuitabilityPage').then((m) => ({ default: m.SuitabilityPage })));
const NotFoundPage = lazy(() => import('./pages/public/NotFoundPage').then((m) => ({ default: m.NotFoundPage })));

export default function App() {
  return (
    <SessionProvider>
      <Suspense fallback={<PageSkeleton />}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/convite-equipe" element={<TeamInviteAcceptPage />} />
          <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
          <Route path="/completar-cadastro-google" element={<CompleteGoogleSignupPage />} />
          <Route path="/completar-cadastro-saml" element={<CompleteSamlSignupPage />} />
          <Route path="/developers" element={<DevelopersPage />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/precos" element={<PrecosPage />} />
          <Route path="/legal" element={<LegalPage />} />
          <Route path="/transparencia" element={<TransparenciaPage />} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="/embed/simulador" element={<EmbedSimuladorPage />} />

          <Route path="/app" element={<AppShell />}>
            <Route path="dashboard" element={<Gate tab="dashboard"><DashboardPage /></Gate>} />
            <Route path="marketplace" element={<Gate tab="marketplace"><MarketplacePage /></Gate>} />
            <Route
              path="automacao"
              element={
                <Gate tab="automacao" requiredPlan="pro" feature="Automação de Lances">
                  <AutomacaoPage />
                </Gate>
              }
            />
            <Route path="comparador" element={<Gate tab="comparador"><ComparadorPage /></Gate>} />
            <Route path="minhas" element={<Gate tab="minhas"><MinhasPage /></Gate>} />
            <Route path="linha-credito" element={<Gate tab="linha-credito"><CreditLinePage /></Gate>} />
            <Route path="contas-pagar" element={<Gate tab="contas-pagar"><ContasPagarPage /></Gate>} />
            <Route
              path="ai-cfo"
              element={
                <Gate tab="ai-cfo" requiredPlan="pro" feature="AI CFO">
                  <AiCfoPage />
                </Gate>
              }
            />
            <Route path="secundario" element={<Gate tab="secundario"><SecundarioPage /></Gate>} />
            <Route path="cestas" element={<Gate tab="cestas"><CestasPage /></Gate>} />
            <Route path="suitability" element={<Gate tab="suitability"><SuitabilityPage /></Gate>} />
            <Route path="risco" element={<Gate tab="risco"><RiscoPage /></Gate>} />
            <Route path="historico" element={<Gate tab="historico"><HistoricoPage /></Gate>} />
            <Route path="erp" element={<Gate tab="erp"><ErpPage /></Gate>} />
            <Route path="emitir" element={<Gate tab="emitir"><EmitirPage /></Gate>} />
            <Route path="compliance" element={<Gate tab="compliance"><CompliancePage /></Gate>} />
            <Route path="dev" element={<Gate tab="dev"><DevPage /></Gate>} />
            <Route path="aceite" element={<Gate tab="aceite"><AceitePage /></Gate>} />
            <Route path="sacado" element={<Gate tab="sacado"><SacadoPage /></Gate>} />
            <Route path="confirming" element={<Gate tab="confirming"><ConfirmingPage /></Gate>} />
            <Route path="disputa" element={<Gate tab="disputa"><DisputaPage /></Gate>} />
            <Route path="perfil" element={<Gate tab="perfil"><PerfilPage /></Gate>} />
            <Route path="conta" element={<Gate tab="conta"><ContaPage /></Gate>} />
            <Route path="receita" element={<Gate tab="receita"><ReceitaPage /></Gate>} />
            <Route path="admin/:tab?" element={<Gate tab="admin"><AdminPage /></Gate>} />
            <Route path="assinatura" element={<Gate tab="assinatura"><AssinaturaPage /></Gate>} />
            <Route path="seguradora" element={<Gate tab="seguradora"><SeguradoraPage /></Gate>} />
            <Route path="auditor" element={<Gate tab="auditor"><AuditorPage /></Gate>} />
            <Route path="publicidade" element={<Gate tab="publicidade"><PublicidadePage /></Gate>} />
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </SessionProvider>
  );
}
