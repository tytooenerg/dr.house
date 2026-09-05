import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { Redis } from 'ioredis';
import { verifyToken } from './auth/jwt.js';
import { listMarketplace } from './db/duplicatas.js';
import { buildOfferView } from './lib/marketCompute.js';
import { logger } from './lib/logger.js';

const CHANNEL = 'lastro:market';
let wss: WebSocketServer | null = null;
// Quem está vendo importa: com leilão real, a oferta carrega "Seu lance"/"Alterar lance",
// que só existem em relação a um investidor. Por isso cada conexão guarda o userId e recebe
// a sua própria renderização, em vez de um payload único compartilhado.
const clients = new Map<WebSocket, number>();

function offersFor(userId: number): string {
  return JSON.stringify({ type: 'offers', offers: listMarketplace().map((d) => buildOfferView(d, userId)) });
}

function broadcastLocal() {
  for (const [ws, userId] of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(offersFor(userId));
  }
}

// Redis is optional: with a single API process (the default for this app) the
// in-memory interval below is all that's needed. REDIS_URL only matters if this
// process is scaled horizontally. O que trafega no canal é só um aviso de "mudou" — não
// mais o payload pronto: como cada cliente vê o leilão pelos próprios lances, quem tem a
// conexão é quem tem que montar o que mandar pra ela.
function setupRedisRelay(): (() => void) | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  const publisher = new Redis(url);
  const subscriber = new Redis(url);
  subscriber.subscribe(CHANNEL).catch((err: Error) => logger.error({ err }, '[ws] failed to subscribe to Redis channel'));
  subscriber.on('message', (channel: string) => {
    if (channel === CHANNEL) broadcastLocal();
  });
  publisher.on('error', (err: Error) => logger.error({ err }, '[ws] redis publisher error'));
  subscriber.on('error', (err: Error) => logger.error({ err }, '[ws] redis subscriber error'));
  logger.info('[ws] Redis pub/sub relay enabled for the marketplace feed');

  return () => {
    publisher.publish(CHANNEL, 'refresh').catch((err: Error) => logger.error({ err }, '[ws] failed to publish market update'));
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
    clients.set(ws, payload.sub);
    ws.send(offersFor(payload.sub));
    ws.on('close', () => clients.delete(ws));
  });

  // Broadcast fresh offer/bid/countdown state on an interval so every connected
  // client sees the live auction tick without polling.
  setInterval(() => {
    if (clients.size === 0 && !publish) return;
    broadcastLocal();
    publish?.();
  }, 2000);

  return wss;
}
