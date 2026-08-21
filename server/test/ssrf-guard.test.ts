import { describe, expect, it } from 'vitest';
import { checkUrlIsPublic } from '../src/lib/ssrfGuard.js';

// lib/ssrfGuard.ts closes a real gap found in the security self-review
// (docs/security-review-2026-08.md, finding SR-1): partner webhook URLs were only checked
// for being *syntactically* a URL, not for where they actually point. These tests exercise
// the guard directly, not through the (VITEST-relaxed) webhook routes, so they reflect the
// real production behavior — including against real DNS via the public internet.

describe('checkUrlIsPublic', () => {
  it('rejects malformed URLs', async () => {
    expect((await checkUrlIsPublic('not a url')).safe).toBe(false);
  });

  it('rejects non-http(s) schemes', async () => {
    expect((await checkUrlIsPublic('file:///etc/passwd')).safe).toBe(false);
    expect((await checkUrlIsPublic('ftp://example.com/x')).safe).toBe(false);
  });

  it('rejects literal private/loopback/link-local IPv4 addresses', async () => {
    expect((await checkUrlIsPublic('http://10.0.0.5/hook')).safe).toBe(false);
    expect((await checkUrlIsPublic('http://172.16.0.1/hook')).safe).toBe(false);
    expect((await checkUrlIsPublic('http://192.168.1.1/hook')).safe).toBe(false);
    // Cloud metadata endpoint (AWS/GCP/Azure) — the canonical SSRF target.
    expect((await checkUrlIsPublic('http://169.254.169.254/latest/meta-data')).safe).toBe(false);
  });

  it('rejects the loopback address by hostname, even under VITEST (only the literal IP is relaxed for the delivery integration tests)', async () => {
    expect((await checkUrlIsPublic('http://localhost/hook')).safe).toBe(false);
  });

  it('rejects an IPv6 loopback/link-local address', async () => {
    expect((await checkUrlIsPublic('http://[::1]/hook')).safe).toBe(false);
    expect((await checkUrlIsPublic('http://[fe80::1]/hook')).safe).toBe(false);
  });

  it('accepts a well-formed public https URL', async () => {
    // A literal public IP needs no DNS lookup — deterministic or online, this always passes.
    expect((await checkUrlIsPublic('https://1.1.1.1/hook')).safe).toBe(true);
  });
});
