import pino from 'pino';
import { pinoHttp } from 'pino-http';
import type { IncomingMessage, ServerResponse } from 'node:http';

const usePretty = process.env.NODE_ENV !== 'production' && !process.env.VITEST;

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: usePretty ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } : undefined,
});

export const httpLogger = pinoHttp({
  logger,
  autoLogging: { ignore: (req: IncomingMessage) => req.url === '/api/health' },
  customLogLevel: (_req: IncomingMessage, res: ServerResponse, err?: Error) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
});
