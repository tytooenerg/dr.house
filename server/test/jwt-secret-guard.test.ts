import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// auth/jwt.ts's JWT_SECRET production guard runs as top-level module code — a real check on
// module load, not something callable from within this already-running test process (env
// vars and ES module caching are both fixed for the whole run). Spawning a real, separate
// `tsx` process per scenario is the only honest way to exercise this — same principle
// sdks/python's own test suite already uses to test the real server as a subprocess.
const serverDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function importJwtModule(env: NodeJS.ProcessEnv) {
  return spawnSync('npx', ['tsx', '-e', "import('./src/auth/jwt.js').then(() => console.log('IMPORTED_OK'))"], {
    cwd: serverDir,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 20_000,
  });
}

describe('JWT_SECRET production guard — a real hard failure, not just a log line', () => {
  it('refuses to start when NODE_ENV=production and JWT_SECRET is unset', () => {
    const result = importJwtModule({ NODE_ENV: 'production', JWT_SECRET: '' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('JWT_SECRET is required when NODE_ENV=production');
    expect(result.stdout).not.toContain('IMPORTED_OK');
  });

  it('starts normally when NODE_ENV=production and a real JWT_SECRET is set', () => {
    const result = importJwtModule({ NODE_ENV: 'production', JWT_SECRET: 'a-real-production-secret-value' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('IMPORTED_OK');
  });

  it('still starts (with only a soft warning) outside production when JWT_SECRET is unset', () => {
    const result = importJwtModule({ NODE_ENV: 'development', JWT_SECRET: '' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('IMPORTED_OK');
  });
});
