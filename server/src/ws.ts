import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { Redis } from 'ioredis';
import { verifyToken } from './auth/jwt.js';
import { listMarketplace } from './db/duplicatas.js';
import { buildOfferView } from './lib/marketCompute.js';
import { logger } from './lib/logger.js';

const CHANNEL = 'lastro:market';
let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();

function broadcastLocal(payload: string) {
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

// Redis is optional: with a single API process (the default for this app) the
// in-memory interval below is all that's needed. REDIS_URL only matters if this
// process is scaled horizontally — each instance still computes its own view of
// the marketplace and publishes it, and every instance (including the publisher)
// relays whatever it receives on the channel to its own locally-connected clients.
function setupRedisRelay(): ((payload: string) => void) | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  const publisher = new Redis(url);
  const subscriber = new Redis(url);
  subscriber.subscribe(CHANNEL).catch((err: Error) => logger.error({ err }, '[ws] failed to subscribe to Redis channel'));
  subscriber.on('message', (channel: string, message: string) => {
    if (channel === CHANNEL) broadcastLocal(message);
  });
  publisher.on('error', (err: Error) => logger.error({ err }, '[ws] redis publisher error'));
  subscriber.on('error', (err: Error) => logger.error({ err }, '[ws] redis subscriber error'));
  logger.info('[ws] Redis pub/sub relay enabled for the marketplace feed');

  return (payload: string) => {
    publisher.publish(CHANNEL, payload).catch((err: Error) => logger.error({ err }, '[ws] failed to publish market update'));
  };
}

export function attachWebSocketServer(server: HttpServer) {
  wss = new WebSocketServer({ server, path: '/ws/market' });
  const publish = setupRedisRelay();

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const token = url.searchParams.get('token');
    const payload = token ? verifyToken(token) : null;
    if (!payload) {
      ws.close(4001, 'unauthorized');
      return;
    }
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'offers', offers: listMarketplace().map(buildOfferView) }));
    ws.on('close', () => clients.delete(ws));
  });

  // Broadcast fresh offer/bid/countdown state on an interval so every connected
  // client sees the live auction tick without polling.
  setInterval(() => {
    if (clients.size === 0 && !publish) return;
    const payload = JSON.stringify({ type: 'offers', offers: listMarketplace().map(buildOfferView) });
    broadcastLocal(payload);
    publish?.(payload);
  }, 2000);

  return wss;
}
