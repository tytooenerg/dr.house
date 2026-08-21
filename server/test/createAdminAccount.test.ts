import { describe, expect, it } from 'vitest';
import { createAdminAccount, CreateAdminError } from '../src/lib/createAdminAccount.js';
import { getUserByEmail } from '../src/db/users.js';
import { verifyPassword } from '../src/auth/password.js';

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// The real (only) way to get a working admin login on a production database — public
// self-registration never allows role=admin (routes/auth.ts's registerSchema) and
// seedIfEmpty() now refuses to auto-create the publicly-documented demo admin account once
// NODE_ENV=production (see seed-production-guard.test.ts). Exercised here directly against
// the real DB/password-hashing pipeline, same as scripts/createAdmin.ts uses.
describe('createAdminAccount — real bootstrap for the first production admin', () => {
  it('creates a real admin account whose stored hash verifies the chosen password', async () => {
    const email = `admin-${unique()}@example.com`;
    const admin = await createAdminAccount({ email, password: 'senha-forte-123', nome: 'Equipe Ops' });
    expect(admin.role).toBe('admin');
    expect(admin.email).toBe(email);
    const stored = getUserByEmail(email)!;
    expect(await verifyPassword('senha-forte-123', stored.password_hash)).toBe(true);
    expect(await verifyPassword('senha-errada', stored.password_hash)).toBe(false);
  });

  it('defaults companyName to "Lastro (plataforma)" when not provided', async () => {
    const email = `admin-${unique()}@example.com`;
    const admin = await createAdminAccount({ email, password: 'senha-forte-123', nome: 'Equipe Ops' });
    expect(admin.company_name).toBe('Lastro (plataforma)');
  });

  it('uses a provided companyName when given', async () => {
    const email = `admin-${unique()}@example.com`;
    const admin = await createAdminAccount({ email, password: 'senha-forte-123', nome: 'Equipe Ops', companyName: 'Minha Empresa Ltda' });
    expect(admin.company_name).toBe('Minha Empresa Ltda');
  });

  it('rejects a password shorter than the admin-specific minimum (8 chars)', async () => {
    await expect(createAdminAccount({ email: `admin-${unique()}@example.com`, password: 'short1', nome: 'X' })).rejects.toThrow(CreateAdminError);
  });

  it('rejects an invalid email', async () => {
    await expect(createAdminAccount({ email: 'not-an-email', password: 'senha-forte-123', nome: 'X' })).rejects.toThrow(CreateAdminError);
  });

  it('rejects a blank nome', async () => {
    await expect(createAdminAccount({ email: `admin-${unique()}@example.com`, password: 'senha-forte-123', nome: '   ' })).rejects.toThrow(
      CreateAdminError
    );
  });

  it('rejects a duplicate email', async () => {
    const email = `admin-${unique()}@example.com`;
    await createAdminAccount({ email, password: 'senha-forte-123', nome: 'X' });
    await expect(createAdminAccount({ email, password: 'outra-senha-123', nome: 'Y' })).rejects.toThrow(CreateAdminError);
  });

  it('lowercases and trims the email', async () => {
    const raw = `Admin-${unique()}@Example.COM`;
    const admin = await createAdminAccount({ email: `  ${raw}  `, password: 'senha-forte-123', nome: 'X' });
    expect(admin.email).toBe(raw.toLowerCase());
  });
});
