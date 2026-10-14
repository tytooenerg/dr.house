// Lista as contas com role 'admin' — somente leitura, não muda nada no banco. Use pra
// descobrir o ADMIN_USER_ID certo antes de rodar reset-admin-credentials (útil quando você
// não lembra o e-mail exato cadastrado na conta, ex.: um e-mail de teste esquecido).
//   docker compose -f docker-compose.prod.yml exec app node server/dist/scripts/listAdmins.js
import { listUsersByRole } from '../db/users.js';

function main() {
  const admins = listUsersByRole('admin');
  if (admins.length === 0) {
    console.log('[list-admins] Nenhuma conta admin encontrada.');
    return;
  }
  console.table(
    admins.map((a) => ({
      id: a.id,
      email: a.email,
      nome: a.nome,
      company_name: a.company_name,
      created_at: a.created_at,
    }))
  );
}

main();
