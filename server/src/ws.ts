import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { verifyToken } from './auth/jwt.js';
import { listMarketplace } from './db/duplicatas.js';
import { buildOfferView } from './lib/marketCompute.js';

let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();

export function attachWebSocketServer(server: HttpServer) {
  wss = new WebSocketServer({ server, path: '/ws/market' });

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
    if (clients.size === 0) return;
    const payload = JSON.stringify({ type: 'offers', offers: listMarketplace().map(buildOfferView) });
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  }, 2000);

  return wss;
}
