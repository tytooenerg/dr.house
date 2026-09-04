import { applyTacitAcceptance } from './aceiteCore.js';

// Achado corrigido: a UI (client/src/pages/app/AceitePage.tsx) e o texto de compliance
// (data/seed.ts's FINANCIADOR_REQS) sempre prometeram "aceite tácito" quando o sacado
// não se manifesta dentro do prazo legal (db/aceites.ts's ACEITE_PRAZO_DIAS = 15 dias)
// — mas nada no sistema de fato aplicava isso; aceiteSlaStatus só calculava
// diasRestantes/vencido pra exibição, e o aceite ficava 'aguardando' pra sempre até o
// sacado agir manualmente. Este job roda diariamente e transiciona pra 'aceita' todo
// aceite vencido sem manifestação — mesmo mecanismo (setAceiteStatus, notificação ao
// cedente, sinal de rede) que uma decisão manual do sacado dispara.

// Only started from src/index.ts (the real server process), same pattern as
// startAceiteReminderJob/startComplianceCalendarReminderJob — importing app.ts in tests
// never spins up a background timer.
export function startAceiteTacitoJob(intervalMs = 24 * 60 * 60 * 1000): NodeJS.Timeout {
  applyTacitAcceptance();
  return setInterval(applyTacitAcceptance, intervalMs);
}
