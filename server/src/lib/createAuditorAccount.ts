import { createUser, getUserByEmail } from '../db/users.js';
import { hashPassword } from '../auth/password.js';

export class CreateAuditorError extends Error {}

export interface CreateAuditorInput {
  email: string;
  password: string;
  nome: string;
  companyName?: string;
}

// Same reasoning as lib/createAdminAccount.ts: 'auditor' is deliberately absent from the
// public /auth/register role enum (routes/auth.ts) — a read-only account that can see
// every tenant's audit log, compliance queue and regulatory reports is not something
// anyone should be able to self-serve into. Created here by an existing admin
// (POST /admin/auditores) rather than a CLI script, since — unlike the very first admin —
// there's always already an admin logged in to do the inviting.
const MIN_PASSWORD_LENGTH = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createAuditorAccount(input: CreateAuditorInput) {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    throw new CreateAuditorError(`E-mail inválido: "${input.email}"`);
  }
  if (!input.password || input.password.length < MIN_PASSWORD_LENGTH) {
    throw new CreateAuditorError(`A senha precisa ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }
  const nome = input.nome?.trim();
  if (!nome) {
    throw new CreateAuditorError('Informe um nome para a conta.');
  }
  if (getUserByEmail(email)) {
    throw new CreateAuditorError(`Já existe uma conta com o e-mail ${email}.`);
  }
  const passwordHash = await hashPassword(input.password);
  return createUser({
    email,
    passwordHash,
    nome,
    companyName: input.companyName?.trim() || 'Auditoria externa',
    role: 'auditor',
  });
}
