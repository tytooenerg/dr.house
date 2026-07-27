import { Route, Routes } from 'react-router-dom';
import { SessionProvider } from './state/SessionContext';
import { AppShell } from './layout/AppShell';
import { Gate } from './components/Gate';
import { LoginPage } from './pages/auth/LoginPage';
import { DashboardPage } from './pages/app/DashboardPage';
import { MarketplacePage } from './pages/app/MarketplacePage';
import { AutomacaoPage } from './pages/app/AutomacaoPage';
import { ComparadorPage } from './pages/app/ComparadorPage';
import { MinhasPage } from './pages/app/MinhasPage';
import { RiscoPage } from './pages/app/RiscoPage';
import { HistoricoPage } from './pages/app/HistoricoPage';
import { ErpPage } from './pages/app/ErpPage';
import { EmitirPage } from './pages/app/EmitirPage';
import { CompliancePage } from './pages/app/CompliancePage';
import { DevPage } from './pages/app/DevPage';
import { AceitePage } from './pages/app/AceitePage';
import { SacadoPage } from './pages/app/SacadoPage';
import { DisputaPage } from './pages/app/DisputaPage';
import { PerfilPage } from './pages/app/PerfilPage';
import { ContaPage } from './pages/app/ContaPage';
import { ReceitaPage } from './pages/app/ReceitaPage';
import { AdminPage } from './pages/app/AdminPage';
import { AssinaturaPage } from './pages/app/AssinaturaPage';
import { SeguradoraPage } from './pages/app/SeguradoraPage';
import { DevelopersPage } from './pages/public/DevelopersPage';
import { PrecosPage } from './pages/public/PrecosPage';
import { LegalPage } from './pages/public/LegalPage';
import { TransparenciaPage } from './pages/public/TransparenciaPage';
import { StatusPage } from './pages/public/StatusPage';
import { EmbedSimuladorPage } from './pages/public/EmbedSimuladorPage';
import { SecundarioPage } from './pages/app/SecundarioPage';
import { CestasPage } from './pages/app/CestasPage';
import { NotFoundPage } from './pages/public/NotFoundPage';

export default function App() {
  return (
    <SessionProvider>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="/developers" element={<DevelopersPage />} />
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
          <Route
            path="comparador"
            element={
              <Gate tab="comparador" requiredPlan="pro" feature="Comparador de Taxas">
                <ComparadorPage />
              </Gate>
            }
          />
          <Route path="minhas" element={<Gate tab="minhas"><MinhasPage /></Gate>} />
          <Route path="secundario" element={<Gate tab="secundario"><SecundarioPage /></Gate>} />
          <Route path="cestas" element={<Gate tab="cestas"><CestasPage /></Gate>} />
          <Route path="risco" element={<Gate tab="risco"><RiscoPage /></Gate>} />
          <Route path="historico" element={<Gate tab="historico"><HistoricoPage /></Gate>} />
          <Route path="erp" element={<Gate tab="erp"><ErpPage /></Gate>} />
          <Route path="emitir" element={<Gate tab="emitir"><EmitirPage /></Gate>} />
          <Route path="compliance" element={<Gate tab="compliance"><CompliancePage /></Gate>} />
          <Route path="dev" element={<Gate tab="dev"><DevPage /></Gate>} />
          <Route path="aceite" element={<Gate tab="aceite"><AceitePage /></Gate>} />
          <Route path="sacado" element={<Gate tab="sacado"><SacadoPage /></Gate>} />
          <Route path="disputa" element={<Gate tab="disputa"><DisputaPage /></Gate>} />
          <Route path="perfil" element={<Gate tab="perfil"><PerfilPage /></Gate>} />
          <Route path="conta" element={<Gate tab="conta"><ContaPage /></Gate>} />
          <Route path="receita" element={<Gate tab="receita"><ReceitaPage /></Gate>} />
          <Route path="admin" element={<Gate tab="admin"><AdminPage /></Gate>} />
          <Route path="assinatura" element={<Gate tab="assinatura"><AssinaturaPage /></Gate>} />
          <Route path="seguradora" element={<Gate tab="seguradora"><SeguradoraPage /></Gate>} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </SessionProvider>
  );
}
