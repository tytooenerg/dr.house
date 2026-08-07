const BASE = '/api';
const TOKEN_KEY = 'lastro_token';
const REFRESH_KEY = 'lastro_refresh';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function setRefreshToken(token: string | null) {
  if (token) localStorage.setItem(REFRESH_KEY, token);
  else localStorage.removeItem(REFRESH_KEY);
}

export function setSessionTokens(token: string | null, refreshToken: string | null) {
  setToken(token);
  setRefreshToken(refreshToken);
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

// Refresh access tokens are single-use, so concurrent 401s share one in-flight
// refresh instead of each racing to spend the same refresh token.
let refreshInFlight: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(BASE + '/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) return false;
        const data = (await res.json()) as { token: string; refreshToken: string };
        setSessionTokens(data.token, data.refreshToken);
        return true;
      } catch {
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

async function request<T>(method: string, path: string, body?: unknown, isRetry = false): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && !isRetry && path !== '/auth/refresh' && path !== '/auth/login') {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(method, path, body, true);
    setSessionTokens(null, null);
    onUnauthorized?.();
  }

  if (!res.ok) {
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      // no JSON body
    }
    const message = (parsed as { message?: string })?.message || `${method} ${path} failed: ${res.status}`;
    throw new ApiError(res.status, message, parsed);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  del: <T>(path: string) => request<T>('DELETE', path),
};

// Exposed for long-lived connections (the marketplace WebSocket) that need a
// guaranteed-fresh access token before (re)connecting, outside the request()/401 flow.
export const refreshAccessToken = tryRefresh;

export async function downloadFile(path: string, filename: string): Promise<void> {
  const token = getToken();
  const res = await fetch(BASE + path, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
  if (!res.ok) throw new ApiError(res.status, `Falha ao exportar ${filename}`, null);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function uploadFile(
  kind: string,
  file: File
): Promise<{
  upload: { id: number; filename: string };
  extracted: Record<string, string> | null;
  analysis: { text: string; severity: 'ok' | 'atencao' | 'critico' }[] | null;
  biometria: { passed: boolean; confidence: number } | null;
}> {
  const token = getToken();
  const form = new FormData();
  form.append('kind', kind);
  form.append('file', file);
  const res = await fetch(BASE + '/uploads', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  if (!res.ok) {
    const parsed = await res.json().catch(() => null);
    throw new ApiError(res.status, parsed?.message || 'Falha no upload', parsed);
  }
  return res.json();
}
