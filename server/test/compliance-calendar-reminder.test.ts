import { describe, expect, it, beforeAll } from 'vitest';
import { seedIfEmpty } from '../src/db/seed.js';
import { createUser, getSettings, updateSettings } from '../src/db/users.js';
import { listNotifications } from '../src/db/misc.js';
import { runComplianceCalendarReminderCheck } from '../src/lib/complianceCalendarReminder.js';
import { OBRIGATORIEDADE_POR_BRACKET } from '../src/lib/complianceCalendarCore.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function register(role: 'cedente' | 'sacado') {
  return createUser({ email: `conf-lembrete-${unique()}@example.com`, passwordHash: 'x', nome: 'T', companyName: `Empresa ${unique()}`, role });
}

describe('Lembrete do Cronograma de Conformidade (lib/complianceCalendarReminder.ts)', () => {
  it('nudges a cedente who never informed a bracket, exactly once', () => {
    const user = register('cedente');

    const first = runComplianceCalendarReminderCheck();
    expect(first.naoInformadoLembrados).toBeGreaterThan(0);
    const notifications = listNotifications(user.id, 20);
    expect(notifications.some((n) => n.text.includes('faixa de faturamento'))).toBe(true);
    const countAfterFirst = notifications.length;

    // Rodar de novo não deve duplicar o lembrete para a mesma conta.
    runComplianceCalendarReminderCheck();
    expect(listNotifications(user.id, 20).length).toBe(countAfterFirst);
  });

  it('does not nudge a sacado whose deadline is still far away', () => {
    const user = register('sacado');
    updateSettings(user.id, { faturamentoAnualBracket: 'ate_4_8m' }); // prazo mais distante do cronograma

    const before = listNotifications(user.id, 20).length;
    const today = new Date('2026-09-01T00:00:00Z'); // bem antes do prazo (2028-06-30)
    runComplianceCalendarReminderCheck(today);
    expect(listNotifications(user.id, 20).length).toBe(before);
    expect(getSettings(user).complianceReminderUrgenciaSentAt).toBeNull();
  });

  it('sends an urgency reminder once the deadline is within the threshold, and only once', () => {
    const user = register('cedente');
    updateSettings(user.id, { faturamentoAnualBracket: 'acima_300m' });

    const deadline = OBRIGATORIEDADE_POR_BRACKET.acima_300m;
    const proximoDoPrazo = new Date(deadline.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 dias antes

    const result = runComplianceCalendarReminderCheck(proximoDoPrazo);
    expect(result.urgenciaLembrados).toBeGreaterThan(0);
    const notifications = listNotifications(user.id, 20);
    expect(notifications.some((n) => n.text.includes('Faltam'))).toBe(true);
    const countAfterFirst = notifications.length;

    runComplianceCalendarReminderCheck(proximoDoPrazo);
    expect(listNotifications(user.id, 20).length).toBe(countAfterFirst);
  });

  it('does not send an urgency reminder for a deadline already in full regime', () => {
    const user = register('cedente');
    updateSettings(user.id, { faturamentoAnualBracket: 'acima_300m' });

    const before = listNotifications(user.id, 20).length;
    const depoisDoPrazo = new Date(OBRIGATORIEDADE_POR_BRACKET.acima_300m.getTime() + 24 * 60 * 60 * 1000);
    const result = runComplianceCalendarReminderCheck(depoisDoPrazo);
    expect(result.urgenciaLembrados).toBe(0);
    expect(listNotifications(user.id, 20).length).toBe(before);
  });
});
