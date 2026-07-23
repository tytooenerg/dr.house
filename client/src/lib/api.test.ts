import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, getRefreshToken, getToken, setSessionTokens, setUnauthorizedHandler } from './api';

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('api client', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    setUnauthorizedHandler(null);
  });

  it('attaches the stored access token as a bearer header', async () => {
    setSessionTokens('access-1', 'refresh-1');
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(200, { ok: true }));

    await api.get('/dashboard');

    const [, init] = fetchMock.mock.calls[0];
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer access-1');
  });

  it('on a 401, silently refreshes the token pair and retries the original request once', async () => {
    setSessionTokens('expired-access', 'valid-refresh');
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) {
        return jsonResponse(200, { token: 'fresh-access', refreshToken: 'fresh-refresh' });
      }
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      if (auth === 'Bearer expired-access') return jsonResponse(401, { error: 'unauthorized' });
      if (auth === 'Bearer fresh-access') return jsonResponse(200, { offers: [] });
      throw new Error('unexpected request: ' + url);
    });

    const result = await api.get<{ offers: unknown[] }>('/market');

    expect(result).toEqual({ offers: [] });
    expect(getToken()).toBe('fresh-access');
    expect(getRefreshToken()).toBe('fresh-refresh');
    // /market (401) -> /auth/refresh -> /market (retry) = 3 calls
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('clears tokens and calls the unauthorized handler when the refresh token itself is invalid', async () => {
    setSessionTokens('expired-access', 'dead-refresh');
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);

    vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) return jsonResponse(401, { error: 'unauthorized' });
      return jsonResponse(401, { error: 'unauthorized', message: 'Sessão expirada' });
    });

    await expect(api.get('/market')).rejects.toBeInstanceOf(ApiError);
    expect(getToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('shares a single in-flight refresh across concurrent 401s instead of racing to spend the same token', async () => {
    setSessionTokens('expired-access', 'valid-refresh');
    let refreshCalls = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) {
        refreshCalls++;
        await new Promise((r) => setTimeout(r, 10));
        return jsonResponse(200, { token: 'fresh-access', refreshToken: 'fresh-refresh' });
      }
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      if (auth === 'Bearer fresh-access') return jsonResponse(200, { ok: true });
      return jsonResponse(401, { error: 'unauthorized' });
    });

    await Promise.all([api.get('/a'), api.get('/b')]);
    expect(refreshCalls).toBe(1);
  });
});
