import { createUser, getUserByEmail } from '../db/users.js';
import { hashPassword } from '../auth/password.js';

export class CreateAdminError extends Error {}

export interface CreateAdminInput {
  email: string;
  password: string;
  nome: string;
  companyName?: string;
}

// A real admin account can see and act on every tenant's data (KYB approvals, PLD
// decisions, dispute arbitration, agent governance...), so it gets a stricter minimum than
// the public self-serve /auth/register endpoint (6 chars — see routes/auth.ts).
const MIN_PASSWORD_LENGTH = 8;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The only way to get a real admin account onto a production database: the public
// /auth/register endpoint's registerSchema deliberately only accepts
// investidor/cedente/sacado/seguradora (see routes/auth.ts), and seedIfEmpty() now refuses
// to auto-create the publicly-documented admin@lastro.demo account once NODE_ENV=production
// (see db/seed.ts). Used by both the CLI bootstrap script (scripts/createAdmin.ts) and, in
// principle, any future "invite another admin" back-office flow — kept here rather than
// inline in the script so it's directly unit-testable without spawning a subprocess.
export async function createAdminAccount(input: CreateAdminInput) {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    throw new CreateAdminError(`E-mail inválido: "${input.email}"`);
  }
  if (!input.password || input.password.length < MIN_PASSWORD_LENGTH) {
    throw new CreateAdminError(`A senha precisa ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }
  const nome = input.nome?.trim();
  if (!nome) {
    throw new CreateAdminError('Informe um nome para a conta.');
  }
  if (getUserByEmail(email)) {
    throw new CreateAdminError(`Já existe uma conta com o e-mail ${email}.`);
  }
  const passwordHash = await hashPassword(input.password);
  return createUser({
    email,
    passwordHash,
    nome,
    companyName: input.companyName?.trim() || 'Lastro (plataforma)',
    role: 'admin',
  });
}
