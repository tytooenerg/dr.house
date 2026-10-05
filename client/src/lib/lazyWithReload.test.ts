import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { loadWithReloadOnce } from './lazyWithReload';

const RELOAD_KEY = 'lastro:chunk-reload-attempted';

describe('loadWithReloadOnce', () => {
  let reloadSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage.clear();
    reloadSpy = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload: reloadSpy });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves normally and clears the reload flag on success', async () => {
    sessionStorage.setItem(RELOAD_KEY, '1'); // leftover from a previous reload
    const mod = { default: 'ok' };
    await expect(loadWithReloadOnce(() => Promise.resolve(mod))).resolves.toBe(mod);
    expect(sessionStorage.getItem(RELOAD_KEY)).toBeNull();
  });

  it('reloads the page once on the first failure, without rejecting', async () => {
    const factory = () => Promise.reject(new Error('Failed to fetch dynamically imported module'));
    let settled = false;
    loadWithReloadOnce(factory).then(
      () => (settled = true),
      () => (settled = true)
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(RELOAD_KEY)).toBe('1');
    expect(settled).toBe(false); // the returned promise never settles — the reload replaces the page
  });

  it('rejects for real on a second failure, without reloading again', async () => {
    sessionStorage.setItem(RELOAD_KEY, '1'); // first attempt already happened
    const error = new Error('still failing after reload');
    await expect(loadWithReloadOnce(() => Promise.reject(error))).rejects.toBe(error);
    expect(reloadSpy).not.toHaveBeenCalled();
  });
});
