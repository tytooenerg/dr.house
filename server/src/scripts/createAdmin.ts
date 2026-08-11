// Real bootstrap for the first admin account on a fresh production database. Public
// self-registration (POST /auth/register) deliberately never allows role=admin, and
// seedIfEmpty() now refuses to auto-create the publicly-documented admin@lastro.demo
// account once NODE_ENV=production (see db/seed.ts) — so this is the actual, supported way
// to get a real admin login on a real deployment. Never runs automatically; invoke
// explicitly, e.g.:
//   ADMIN_EMAIL=voce@suaempresa.com.br ADMIN_PASSWORD='...' ADMIN_NOME='Sua Equipe' \
//     npm run create-admin --workspace=server
// or, against a running container:
//   docker compose -f docker-compose.prod.yml exec \
//     -e ADMIN_EMAIL=voce@suaempresa.com.br -e ADMIN_PASSWORD='...' -e ADMIN_NOME='Sua Equipe' \
//     app node server/dist/scripts/createAdmin.js
// See DEPLOY.md for the full walkthrough.
import { createAdminAccount, CreateAdminError } from '../lib/createAdminAccount.js';

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const nome = process.env.ADMIN_NOME;
  const companyName = process.env.ADMIN_COMPANY;

  if (!email || !password || !nome) {
    console.error(
      [
        'Uso: defina as variáveis de ambiente ADMIN_EMAIL, ADMIN_PASSWORD e ADMIN_NOME antes de rodar este script.',
        '',
        'Exemplo:',
        "  ADMIN_EMAIL=voce@suaempresa.com.br ADMIN_PASSWORD='senha-forte-de-verdade' ADMIN_NOME='Sua Equipe' \\",
        '    npm run create-admin --workspace=server',
        '',
        '(ADMIN_COMPANY é opcional.)',
      ].join('\n')
    );
    process.exit(1);
  }

  try {
    const admin = await createAdminAccount({ email, password, nome, companyName });
    console.log(`[create-admin] Conta admin criada: ${admin.email} (id ${admin.id}). Faça login normalmente em /login.`);
    process.exit(0);
  } catch (err) {
    if (err instanceof CreateAdminError) {
      console.error(`[create-admin] ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

main();
