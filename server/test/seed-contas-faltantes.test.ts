import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { db } from '../src/db/index.js';
import { getUserByEmail } from '../src/db/users.js';
import { DEMO_ACCOUNTS, seedIfEmpty, seedMissingDemoAccounts } from '../src/db/seed.js';

// `seedIfEmpty()` é tudo-ou-nada: sai na primeira linha se a tabela `users` tiver qualquer
// registro. Toda conta de demonstração acrescentada DEPOIS que alguém já rodou a aplicação uma
// vez nunca chega no banco dessa pessoa — e o sintoma é péssimo de diagnosticar, porque o login
// responde "E-mail ou senha incorretos" tanto para senha errada quanto para e-mail inexistente.
// Foi o que aconteceu com auditor@lastro.demo, acrescentado depois dos outros cinco: quem já
// tinha um server/data/lastro.db não recebe a conta, e a tela insiste que a senha está errada.
//
// A suíte inteira é cega pra isso POR CONSTRUÇÃO: todo teste roda com DB_PATH=':memory:', ou
// seja, sempre num banco vazio, onde o seed roda por completo. varredura-conta-seed.test.ts já
// afirma que a conta de auditor existe e loga — e passava enquanto bancos de desenvolvimento
// reais no mundo não tinham a conta. Por isso este arquivo constrói de propósito o estado que
// nenhum outro teste vê: um banco JÁ semeado ao qual falta uma conta.

beforeAll(async () => {
  await seedIfEmpty();
});

describe('contas de demonstração acrescentadas depois chegam a bancos já semeados', () => {
  it('a conta que falta é recriada, e loga de verdade', async () => {
    // O banco antigo: semeado, com tudo, menos o auditor.
    db.prepare("DELETE FROM users WHERE email = 'auditor@lastro.demo'").run();
    expect(getUserByEmail('auditor@lastro.demo')).toBeUndefined();

    const antes = await request(app).post('/api/auth/login').send({ email: 'auditor@lastro.demo', password: 'demo1234' });
    expect(antes.status, 'a senha está certa — o que falta é a conta').toBe(401);

    const criadas = await seedMissingDemoAccounts();
    expect(criadas).toBe(1);

    const depois = await request(app).post('/api/auth/login').send({ email: 'auditor@lastro.demo', password: 'demo1234' });
    expect(depois.status).toBe(200);
    expect(depois.body.user.role).toBe('auditor');

    // E chega mesmo ao painel — a conta é útil, não só existente.
    const painel = await request(app).get('/api/auditor/overview').set('Authorization', `Bearer ${depois.body.token}`);
    expect(painel.status).toBe(200);
  });

  it('não faz nada quando não falta ninguém', async () => {
    expect(await seedMissingDemoAccounts()).toBe(0);
  });

  it('num banco que nunca foi de demonstração, não cria conta nenhuma', async () => {
    // Injetar conta com senha pública documentada no banco real de alguém é justamente o que o
    // guard de produção do seed existe pra impedir. Sem a conta âncora, o backfill não age.
    // Renomear em vez de apagar: a esta altura as contas já têm linhas em audit_log
    // apontando pra elas, e o que importa aqui é o e-mail que o backfill procura.
    const antes = (db.prepare('SELECT COUNT(*) as n FROM users').get() as { n: number }).n;
    const ancora = getUserByEmail('investidor@lastro.demo')!;
    const auditor = getUserByEmail('auditor@lastro.demo')!;
    db.prepare("UPDATE users SET email = 'titular@empresa-real.com.br' WHERE id = ?").run(ancora.id);
    db.prepare("UPDATE users SET email = 'auditoria@empresa-real.com.br' WHERE id = ?").run(auditor.id);
    try {
      expect(getUserByEmail('auditor@lastro.demo')).toBeUndefined();
      expect(await seedMissingDemoAccounts()).toBe(0);
      expect(getUserByEmail('auditor@lastro.demo')).toBeUndefined();
    } finally {
      db.prepare('UPDATE users SET email = ? WHERE id = ?').run(ancora.email, ancora.id);
      db.prepare('UPDATE users SET email = ? WHERE id = ?').run(auditor.email, auditor.id);
    }
    expect((db.prepare('SELECT COUNT(*) as n FROM users').get() as { n: number }).n).toBe(antes);
  });

  it('a lista e o seed não podem se separar: toda conta de DEMO_ACCOUNTS existe depois do seed', () => {
    // Sem isto, alguém acrescenta a próxima conta direto no corpo do seedIfEmpty, o backfill
    // não fica sabendo, e o bug volta idêntico no papel seguinte.
    for (const conta of DEMO_ACCOUNTS) {
      const u = getUserByEmail(conta.email);
      expect(u, `${conta.email} está em DEMO_ACCOUNTS e não foi criada pelo seed`).toBeTruthy();
      expect(u!.role).toBe(conta.role);
    }
    expect(DEMO_ACCOUNTS.length).toBe(6);
  });
});
