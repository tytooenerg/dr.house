// Corrige uma conta admin real que ficou com e-mail/senha de placeholder — por exemplo,
// alguém rodou `create-admin` copiando os valores de exemplo do DEPLOY.md ao pé da letra em
// vez de substituir pelos próprios dados. Rode `list-admins` primeiro pra descobrir o
// ADMIN_USER_ID certo. Nunca roda automaticamente; invoque explicitamente, e.g.:
//   ADMIN_USER_ID=3 ADMIN_NEW_EMAIL=voce@suaempresa.com.br ADMIN_NEW_PASSWORD='...' \
//     npm run reset-admin-credentials --workspace=server
// ou, contra um container em produção:
//   docker compose -f docker-compose.prod.yml exec \
//     -e ADMIN_USER_ID=3 -e ADMIN_NEW_EMAIL=voce@suaempresa.com.br -e ADMIN_NEW_PASSWORD='...' \
//     app node server/dist/scripts/resetAdminCredentials.js
// Veja DEPLOY.md para o walkthrough completo.
import { resetAdminCredentials, ResetAdminCredentialsError } from '../lib/resetAdminCredentials.js';

async function main() {
  const userIdRaw = process.env.ADMIN_USER_ID;
  const newEmail = process.env.ADMIN_NEW_EMAIL;
  const newPassword = process.env.ADMIN_NEW_PASSWORD;

  if (!userIdRaw || !newEmail || !newPassword) {
    console.error(
      [
        'Uso: defina as variáveis de ambiente ADMIN_USER_ID, ADMIN_NEW_EMAIL e ADMIN_NEW_PASSWORD antes de rodar este script.',
        '',
        'Rode `npm run list-admins --workspace=server` primeiro pra descobrir o ADMIN_USER_ID certo.',
        '',
        'Exemplo:',
        "  ADMIN_USER_ID=3 ADMIN_NEW_EMAIL=voce@suaempresa.com.br ADMIN_NEW_PASSWORD='senha-forte-de-verdade' \\",
        '    npm run reset-admin-credentials --workspace=server',
      ].join('\n')
    );
    process.exit(1);
  }

  const userId = Number(userIdRaw);
  if (!Number.isInteger(userId) || userId <= 0) {
    console.error(`[reset-admin-credentials] ADMIN_USER_ID inválido: "${userIdRaw}".`);
    process.exit(1);
  }

  try {
    const updated = await resetAdminCredentials({ userId, newEmail, newPassword });
    console.log(`[reset-admin-credentials] Credenciais atualizadas para o usuário ${updated.id}: ${updated.email}. Faça login normalmente em /login.`);
    process.exit(0);
  } catch (err) {
    if (err instanceof ResetAdminCredentialsError) {
      console.error(`[reset-admin-credentials] ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

main();
