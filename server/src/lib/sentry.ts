import * as Sentry from '@sentry/node';
import { logger } from './logger.js';

const dsn = process.env.SENTRY_DSN;

export const sentryEnabled = !!dsn;

if (dsn) {
  Sentry.init({ dsn, tracesSampleRate: 0.1, environment: process.env.NODE_ENV || 'development' });
  logger.info('[sentry] error tracking enabled');
}

export function captureError(err: unknown) {
  if (dsn) Sentry.captureException(err);
}
