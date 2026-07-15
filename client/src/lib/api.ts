const BASE = '/api';
const TOKEN_KEY = 'lastro_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    setToken(null);
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
  del: <T>(path: string) => request<T>('DELETE', path),
};

export async function uploadFile(kind: string, file: File): Promise<{ upload: { id: number; filename: string }; extracted: Record<string, string> | null }> {
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
