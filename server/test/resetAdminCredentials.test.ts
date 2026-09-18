import { describe, expect, it } from 'vitest';
import { resetAdminCredentials, ResetAdminCredentialsError } from '../src/lib/resetAdminCredentials.js';
import { createAdminAccount } from '../src/lib/createAdminAccount.js';
import { createUser, getUserByEmail } from '../src/db/users.js';
import { hashPassword, verifyPassword } from '../src/auth/password.js';
import { listAuditLog } from '../src/db/audit.js';

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Recuperação de uma conta admin real que ficou com e-mail/senha de placeholder (ex.:
// create-admin rodado copiando os valores de exemplo do DEPLOY.md ao pé da letra). Exercida
// aqui direto contra o mesmo pipeline real de hashing/DB que scripts/resetAdminCredentials.ts
// usa em produção.
describe('resetAdminCredentials — corrige e-mail/senha de uma conta admin existente', () => {
  it('troca e-mail e senha de uma conta admin: a senha antiga para de verificar e a nova passa a verificar', async () => {
    const admin = await createAdminAccount({ email: `admin-${unique()}@example.com`, password: 'senha-antiga-123', nome: 'Equipe Ops' });
    const newEmail = `admin-novo-${unique()}@example.com`;

    const updated = await resetAdminCredentials({ userId: admin.id, newEmail, newPassword: 'senha-nova-456' });

    expect(updated.email).toBe(newEmail);
    const stored = getUserByEmail(newEmail)!;
    expect(await verifyPassword('senha-nova-456', stored.password_hash)).toBe(true);
    expect(await verifyPassword('senha-antiga-123', stored.password_hash)).toBe(false);
  });

  it('rejeita quando o usuário não é admin', async () => {
    const passwordHash = await hashPassword('senha-123456');
    const cedente = createUser({
      email: `cedente-${unique()}@example.com`,
      passwordHash,
      nome: 'Cedente X',
      companyName: 'Empresa X',
      role: 'cedente',
    });

    await expect(
      resetAdminCredentials({ userId: cedente.id, newEmail: `novo-${unique()}@example.com`, newPassword: 'senha-nova-456' })
    ).rejects.toThrow(ResetAdminCredentialsError);
  });

  it('rejeita um userId inexistente', async () => {
    await expect(
      resetAdminCredentials({ userId: 999_999_999, newEmail: `novo-${unique()}@example.com`, newPassword: 'senha-nova-456' })
    ).rejects.toThrow(ResetAdminCredentialsError);
  });

  it('rejeita e-mail inválido', async () => {
    const admin = await createAdminAccount({ email: `admin-${unique()}@example.com`, password: 'senha-antiga-123', nome: 'Equipe Ops' });
    await expect(resetAdminCredentials({ userId: admin.id, newEmail: 'not-an-email', newPassword: 'senha-nova-456' })).rejects.toThrow(
      ResetAdminCredentialsError
    );
  });

  it('rejeita senha curta (menos de 8 caracteres)', async () => {
    const admin = await createAdminAccount({ email: `admin-${unique()}@example.com`, password: 'senha-antiga-123', nome: 'Equipe Ops' });
    await expect(
      resetAdminCredentials({ userId: admin.id, newEmail: `novo-${unique()}@example.com`, newPassword: 'curta1' })
    ).rejects.toThrow(ResetAdminCredentialsError);
  });

  it('rejeita e-mail já usado por outra conta', async () => {
    const admin = await createAdminAccount({ email: `admin-${unique()}@example.com`, password: 'senha-antiga-123', nome: 'Equipe Ops' });
    const outro = await createAdminAccount({ email: `outro-${unique()}@example.com`, password: 'senha-antiga-123', nome: 'Outra Equipe' });

    await expect(resetAdminCredentials({ userId: admin.id, newEmail: outro.email, newPassword: 'senha-nova-456' })).rejects.toThrow(
      ResetAdminCredentialsError
    );
  });

  it('permite manter o mesmo e-mail, trocando só a senha', async () => {
    const email = `admin-${unique()}@example.com`;
    const admin = await createAdminAccount({ email, password: 'senha-antiga-123', nome: 'Equipe Ops' });

    const updated = await resetAdminCredentials({ userId: admin.id, newEmail: email, newPassword: 'senha-nova-456' });

    expect(updated.email).toBe(email);
    expect(await verifyPassword('senha-nova-456', updated.password_hash)).toBe(true);
  });

  it('grava um evento de auditoria sem incluir a senha no payload', async () => {
    const admin = await createAdminAccount({ email: `admin-${unique()}@example.com`, password: 'senha-antiga-123', nome: 'Equipe Ops' });
    const newEmail = `admin-novo-${unique()}@example.com`;

    await resetAdminCredentials({ userId: admin.id, newEmail, newPassword: 'senha-nova-456' });

    const [last] = listAuditLog(1);
    expect(last.action).toBe('admin.credentials_reset_cli');
    expect(last.actor_user_id).toBe(admin.id);
    expect(last.payload).not.toContain('senha-nova-456');
    expect(JSON.parse(last.payload)).toMatchObject({ userId: admin.id, newEmail });
  });
});
