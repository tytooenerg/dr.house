import { listUsersByRole, getSettings, updateSettings } from '../db/users.js';
import { addNotification } from '../db/misc.js';
import { buildComplianceCalendarView } from './complianceCalendarCore.js';
import { COLORS } from '../data/seed.js';

// Mesmo papel de lib/aceiteReminder.ts, mas pro Cronograma de Conformidade da Duplicata
// Escritural: sem esse job, o único jeito de alguém saber que precisa informar o
// faturamento — ou que o prazo de obrigatoriedade está chegando — é entrar sozinho na
// Central de Compliance (cedente) ou no Portal do Sacado e reparar no card. Dois lembretes
// distintos, cada um enviado só uma vez por conta (dois carimbos separados em
// UserSettings — ver o comentário lá): um nudge simples pra quem nunca informou nada, e um
// aviso de urgência pra quem já informou mas está a poucos meses do prazo obrigatório.
const URGENCIA_THRESHOLD_DIAS = 90;

export interface ComplianceCalendarReminderResult {
  naoInformadoLembrados: number;
  urgenciaLembrados: number;
}

export function runComplianceCalendarReminderCheck(today: Date = new Date()): ComplianceCalendarReminderResult {
  let naoInformadoLembrados = 0;
  let urgenciaLembrados = 0;

  for (const role of ['cedente', 'sacado'] as const) {
    for (const user of listUsersByRole(role)) {
      const view = buildComplianceCalendarView(user, today);
      const settings = getSettings(user);

      if (view.status === 'nao_informado') {
        if (settings.complianceReminderNaoInformadoSentAt) continue;
        const texto =
          'Você ainda não informou a faixa de faturamento anual da sua empresa — isso define seu prazo de obrigatoriedade da duplicata escritural. Confira em Compliance.';
        addNotification(user.id, texto, COLORS.AMBER, 'compliance');
        updateSettings(user.id, { complianceReminderNaoInformadoSentAt: new Date().toISOString() });
        naoInformadoLembrados++;
        continue;
      }

      if (view.status === 'assistida_disponivel' && view.diasRestantes !== null && view.diasRestantes <= URGENCIA_THRESHOLD_DIAS) {
        if (settings.complianceReminderUrgenciaSentAt) continue;
        const texto = `Faltam ${view.diasRestantes} dia(s) para a duplicata escritural se tornar obrigatória para a sua empresa (${view.bracketLabel}). Confira em Compliance.`;
        addNotification(user.id, texto, COLORS.RED, 'compliance');
        updateSettings(user.id, { complianceReminderUrgenciaSentAt: new Date().toISOString() });
        urgenciaLembrados++;
      }
    }
  }

  return { naoInformadoLembrados, urgenciaLembrados };
}

// Só iniciado a partir de src/index.ts (o processo real do servidor) — importar app.ts nos
// testes nunca sobe esse timer, mesmo padrão de startAceiteReminderJob.
export function startComplianceCalendarReminderJob(intervalMs = 24 * 60 * 60 * 1000): NodeJS.Timeout {
  runComplianceCalendarReminderCheck();
  return setInterval(runComplianceCalendarReminderCheck, intervalMs);
}
