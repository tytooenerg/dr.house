import { getUserById, getUserByEmail, updateCredentials } from '../db/users.js';
import { hashPassword } from '../auth/password.js';
import { recordAuditEvent } from '../db/audit.js';

export class ResetAdminCredentialsError extends Error {}

export interface ResetAdminCredentialsInput {
  userId: number;
  newEmail: string;
  newPassword: string;
}

const MIN_PASSWORD_LENGTH = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Recuperação de uma conta admin real que ficou com e-mail/senha de placeholder (ex.:
// alguém rodou create-admin copiando os valores de exemplo do DEPLOY.md ao pé da letra).
// Só existe pra corrigir uma conta que já é admin — nunca promove nem cria; por isso exige
// role === 'admin' no alvo, o que impede este script de virar uma ferramenta genérica de
// account-takeover contra qualquer usuário da plataforma. Usado por
// scripts/resetAdminCredentials.ts, mantido aqui (fora do CLI) pelo mesmo motivo de
// lib/createAdminAccount.ts: testável direto, sem subprocesso.
export async function resetAdminCredentials(input: ResetAdminCredentialsInput) {
  const user = getUserById(input.userId);
  if (!user) {
    throw new ResetAdminCredentialsError(`Nenhum usuário com id ${input.userId}.`);
  }
  if (user.role !== 'admin') {
    throw new ResetAdminCredentialsError(
      `O usuário ${input.userId} não é admin (role: ${user.role}) — este script só reseta contas admin.`
    );
  }

  const newEmail = input.newEmail.trim().toLowerCase();
  if (!EMAIL_RE.test(newEmail)) {
    throw new ResetAdminCredentialsError(`E-mail inválido: "${input.newEmail}"`);
  }
  const existing = getUserByEmail(newEmail);
  if (existing && existing.id !== user.id) {
    throw new ResetAdminCredentialsError(`Já existe outra conta com o e-mail ${newEmail}.`);
  }

  if (!input.newPassword || input.newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new ResetAdminCredentialsError(`A senha precisa ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }

  const passwordHash = await hashPassword(input.newPassword);
  const oldEmail = user.email;
  const updated = updateCredentials(user.id, newEmail, passwordHash);
  recordAuditEvent(user.id, user.company_name, 'admin.credentials_reset_cli', { userId: user.id, oldEmail, newEmail });
  return updated;
}
