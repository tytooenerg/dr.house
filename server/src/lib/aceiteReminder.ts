import { aceiteSlaStatus, listAguardandoSemLembrete, markReminderSent } from '../db/aceites.js';
import { getUserById, getSettings } from '../db/users.js';
import { fmtBRL } from './format.js';
import { sendWhatsapp } from './smsNotifier.js';
import { logger } from './logger.js';

// The 15-day aceite window (aceites.ts's ACEITE_PRAZO_DIAS) is the single biggest UX/legal
// risk in the whole flow — a sacado who misses it puts the duplicata's validity at risk.
// Email alone is a weak channel for a time-pressured deadline; this sends one urgent
// WhatsApp reminder per aceite once it's down to REMINDER_THRESHOLD_DIAS or fewer days
// remaining, to whichever sacado account (if any) is registered for that company name.
const REMINDER_THRESHOLD_DIAS = 2;

function runCheck() {
  const candidates = listAguardandoSemLembrete();
  for (const a of candidates) {
    const { diasRestantes, vencido } = aceiteSlaStatus(a);
    if (diasRestantes === null || vencido || diasRestantes > REMINDER_THRESHOLD_DIAS) continue;
    if (!a.sacado_telefone) {
      // No registered sacado account/phone for this company — mark it anyway so the job
      // doesn't re-check it every cycle; there's nowhere to send a reminder yet.
      markReminderSent(a.id);
      continue;
    }
    // White-label (Integrações ERP): a cedente on the Empresarial plan can set a brand for
    // exactly this kind of communication with their own fornecedores — the reminder reads
    // as coming from them, "powered by Lastro", instead of raw "Lastro".
    const cedente = a.cedente_id ? getUserById(a.cedente_id) : undefined;
    const brand = cedente ? getSettings(cedente).whitelabelBrand : null;
    const remetente = brand ? `${brand.nome} (via Lastro)` : 'Lastro';
    const texto = `${remetente}: você tem ${diasRestantes} dia(s) para confirmar ou contestar a duplicata de ${fmtBRL(a.valor)} (${a.sacado_nome}). Acesse o Portal do Sacado.`;
    sendWhatsapp(a.sacado_telefone, texto)
      .then(() => markReminderSent(a.id))
      .catch((err) => logger.warn({ err, aceiteId: a.id }, '[aceite-reminder] falha ao enviar lembrete'));
  }
}

// Only started from src/index.ts (the real server process), same pattern as
// startHealthMonitor — importing app.ts in tests never spins up a background timer.
export function startAceiteReminderJob(intervalMs = 6 * 60 * 60 * 1000): NodeJS.Timeout {
  runCheck();
  return setInterval(runCheck, intervalMs);
}
