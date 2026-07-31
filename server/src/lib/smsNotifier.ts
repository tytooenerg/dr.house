import { logger } from './logger.js';

// Real WhatsApp/SMS via Twilio's actual REST API — same honest pattern as mailer.ts's
// SMTP transport: real HTTP calls when TWILIO_* is configured, logged instead of sent
// otherwise, so the app works fully without an account. Prioritized for aceite deadline
// reminders (server/src/lib/aceiteReminder.ts) — email alone has poor open rates against
// a tight legal window, and WhatsApp is the dominant business-notification channel in
// Brazil.
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const whatsappFrom = process.env.TWILIO_WHATSAPP_FROM; // e.g. "whatsapp:+14155238886"
const smsFrom = process.env.TWILIO_SMS_FROM; // e.g. "+15551234567"

export const twilioEnabled = !!(accountSid && authToken);

if (twilioEnabled) logger.info('[twilio] configurado — notificações WhatsApp/SMS reais habilitadas');
else logger.info('[twilio] TWILIO_ACCOUNT_SID/AUTH_TOKEN não configurado — WhatsApp/SMS serão apenas logados');

async function sendViaTwilio(from: string | undefined, to: string, body: string): Promise<void> {
  if (!twilioEnabled || !from) {
    logger.info({ to, body }, '[twilio] (simulado) mensagem seria enviada — configure TWILIO_* para enviar de verdade');
    return;
  }
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ From: from, To: to, Body: body }).toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    logger.warn({ status: res.status, text, to }, '[twilio] falha ao enviar mensagem');
    return;
  }
  logger.info({ to }, '[twilio] mensagem enviada');
}

export async function sendWhatsapp(toPhone: string, body: string): Promise<void> {
  const to = toPhone.startsWith('whatsapp:') ? toPhone : `whatsapp:${normalizePhone(toPhone)}`;
  await sendViaTwilio(whatsappFrom, to, body);
}

export async function sendSms(toPhone: string, body: string): Promise<void> {
  await sendViaTwilio(smsFrom, normalizePhone(toPhone), body);
}

// Best-effort E.164-ish normalization: assumes a Brazilian number when no country code is
// present (bare digits without a leading "+"), since that's this platform's user base.
function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith('+')) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  return digits ? `+55${digits}` : trimmed;
}
