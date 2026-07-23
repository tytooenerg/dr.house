import { useEffect, useRef, useState } from 'react';
import { getToken, refreshAccessToken } from './api';

export function useMarketSocket<T>() {
  const [offers, setOffers] = useState<T[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!getToken()) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout>;

    async function connect() {
      // Access tokens are short-lived (15min); refresh proactively so a WS reconnect
      // after a long idle period doesn't hand the server an already-expired token.
      await refreshAccessToken();
      const token = getToken();
      if (cancelled || !token) return;

      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${protocol}://${window.location.host}/ws/market?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'offers') setOffers(msg.offers);
        } catch {
          // ignore malformed frames
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!cancelled) retryTimer = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      wsRef.current?.close();
    };
  }, []);

  return { offers, connected };
}
