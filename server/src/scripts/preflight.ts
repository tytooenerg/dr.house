// Checagem de prontidão para produção, para rodar NO SERVIDOR antes de abrir para clientes.
//
//   NODE_ENV=production npm run preflight --workspace=server
//
// Sai com código 1 quando a instância está em produção e algum trilho de dinheiro está
// simulado — assim dá pra encadear num deploy (`npm run preflight && docker compose up -d`)
// e o deploy para sozinho em vez de subir uma plataforma que aceitaria depósito de mentira.
//
// Precisa das MESMAS variáveis de ambiente com que o servidor sobe: ele lê a configuração do
// próprio processo, então rodar sem o .env carregado responde sobre um ambiente que não é o
// que vai atender os clientes. Com docker compose, o jeito certo é
// `docker compose -f docker-compose.prod.yml run --rm app node server/dist/scripts/preflight.js`.
import { prontidao, resumoDeBoot, type ItemDePreflight } from '../lib/preflight.js';

const VERDE = '\x1b[32m';
const VERMELHO = '\x1b[31m';
const AMARELO = '\x1b[33m';
const NEGRITO = '\x1b[1m';
const FIM = '\x1b[0m';

function linha(item: ItemDePreflight, exigido: boolean) {
  const marca = item.real ? `${VERDE}✓ real${FIM}` : exigido ? `${VERMELHO}✗ simulado${FIM}` : `${AMARELO}• simulado${FIM}`;
  console.log(`   ${marca}  ${item.nome}`);
  if (!item.real) {
    console.log(`            ${item.semEle}`);
    console.log(`            configure: ${item.envs.join(', ')}`);
  }
}

const p = prontidao();

console.log(`\n${NEGRITO}Preflight — Lastro${FIM}`);
console.log(`modo: ${p.modo === 'producao' ? `${NEGRITO}produção${FIM}` : `${AMARELO}demonstração${FIM} (NODE_ENV≠production ou SEED_DEMO_DATA=true)`}\n`);

console.log(`${NEGRITO}Trilhos de dinheiro${FIM} — a fronteira entre o saldo interno e o mundo`);
for (const t of p.dinheiro) linha(t, p.modo === 'producao');

console.log(`\n${NEGRITO}Integrações${FIM} — importam, mas não movem dinheiro sozinhas`);
for (const i of p.integracoes) linha(i, false);

console.log(`\n${resumoDeBoot()}`);

if (p.modo === 'demonstracao') {
  console.log(`${AMARELO}Esta instância é uma demonstração: dinheiro simulado é o comportamento desejado e nada está bloqueado.${FIM}\n`);
  process.exit(0);
}

if (p.bloqueados.length > 0) {
  console.log(
    `${VERMELHO}Depósito e saque estão BLOQUEADOS nos trilhos: ${p.bloqueados.join(', ')}.${FIM}\n` +
      `A plataforma recusa (503) em vez de criar saldo que não existe. Configure um PSP real para liberar.\n`
  );
}

// Um lembrete que nenhuma variável de ambiente resolve, e que é o que de fato separa "no ar" de
// "operando": ver DEPLOY.md §9 e docs/security-review-2026-08.md.
console.log(
  `${NEGRITO}Fora do alcance deste check:${FIM} contrato com registradora autorizada (Res. BCB nº 339/2023),\n` +
    `a autorização regulatória para manter saldo de terceiros, e o jurídico do produto (termos,\n` +
    `contrato de cessão, LGPD). Configurar credencial não substitui nenhum dos três.\n`
);

process.exit(p.podeMoverDinheiro ? 0 : 1);
