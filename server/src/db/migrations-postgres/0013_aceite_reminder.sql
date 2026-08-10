-- Tracks whether an urgent deadline reminder (WhatsApp/SMS — see
-- lib/aceiteReminder.ts) has already been sent for an aguardando aceite, so the
-- background job doesn't re-notify the sacado every time it runs.
ALTER TABLE aceites ADD COLUMN reminder_sent INTEGER NOT NULL DEFAULT 0;
