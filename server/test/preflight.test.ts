import { describe, expect, it, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { modoDemonstracao, prontidao, resumoDeBoot, trilhosDeDinheiro } from '../src/lib/preflight.js';

// O acidente que este trinco existe pra impedir:
//
// A disciplina "real-when-configured" faz cada integração cair num modo simulado ROTULADO
// quando a credencial falta. O rótulo era honesto e não impedia nada. Com NODE_ENV=production
// e PIX_PSP_* em branco, um cliente real abria Conta & Liquidação, pedia um depósito, recebia
// uma cobrança simulada e via o saldo aparecer. Ele acha que depositou. A única fonte da
// verdade era uma linha no log de subida do servidor, que ninguém lê no momento que importa.
//
// Nada nos testes anteriores cobria isso porque a suíte nunca roda com NODE_ENV=production —
// exatamente o único modo em que o problema existe.

beforeAll(async () => {
  await seedIfEmpty();
});

const NODE_ENV_ORIGINAL = process.env.NODE_ENV;
const SEED_ORIGINAL = process.env.SEED_DEMO_DATA;

afterEach(() => {
  if (NODE_ENV_ORIGINAL === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = NODE_ENV_ORIGINAL;
  if (SEED_ORIGINAL === undefined) delete process.env.SEED_DEMO_DATA;
  else process.env.SEED_DEMO_DATA = SEED_ORIGINAL;
});

const unico = () => `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`;

async function cedente() {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Titular Teste', email: `pre-${unico()}@example.com`, password: 'senha123', companyName: `Empresa ${unico()}`, role: 'cedente' });
  return res.body.token as string;
}

describe('trinco: em produção, dinheiro só entra e sai por trilho real', () => {
  it('produção sem PSP recusa o depósito em vez de fingir — e diz qual credencial falta', async () => {
    const token = await cedente();
    process.env.NODE_ENV = 'production';
    delete process.env.SEED_DEMO_DATA;

    const res = await request(app).post('/api/account/deposit').set('Authorization', `Bearer ${token}`).send({ valor: 5000 });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('trilho_simulado');
    expect(res.body.trilho).toBe('pix');
    // A mensagem precisa dizer o que fazer, não só que recusou.
    expect(res.body.envs).toContain('PIX_PSP_BASE_URL');
    expect(res.body.message).toMatch(/produção/);
  });

  it('confirmar um depósito simulado também é recusado — é o passo que cria o saldo falso', async () => {
    const token = await cedente();
    process.env.NODE_ENV = 'production';
    delete process.env.SEED_DEMO_DATA;

    const res = await request(app).post('/api/account/deposit/qualquer-txid/confirm-simulado').set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('trilho_simulado');
  });

  it('o saque também, nos dois sentidos do dinheiro', async () => {
    const token = await cedente();
    process.env.NODE_ENV = 'production';
    delete process.env.SEED_DEMO_DATA;

    const res = await request(app).post('/api/account/withdraw').set('Authorization', `Bearer ${token}`).send({ valor: 100 });
    expect(res.status).toBe(503);
    expect(res.body.trilho).toBe('pix');
  });

  it('cada trilho responde por si: TED bloqueado é TED, não Pix', async () => {
    const token = await cedente();
    process.env.NODE_ENV = 'production';
    delete process.env.SEED_DEMO_DATA;

    const res = await request(app).post('/api/account/deposit/ted').set('Authorization', `Bearer ${token}`).send({ valor: 5000 });
    expect(res.status).toBe(503);
    expect(res.body.trilho).toBe('ted');
    expect(res.body.envs).toContain('TED_PSP_BASE_URL');
  });

  it('uma instância de DEMONSTRAÇÃO continua aberta — é o webServer do e2e e o ambiente de vendas', async () => {
    const token = await cedente();
    process.env.NODE_ENV = 'production';
    process.env.SEED_DEMO_DATA = 'true';

    const res = await request(app).post('/api/account/deposit').set('Authorization', `Bearer ${token}`).send({ valor: 5000 });
    expect(res.status).toBe(200);
    expect(res.body.simulado).toBe(true);
  });

  it('fora de produção nada muda — o desenvolvimento segue como sempre', async () => {
    const token = await cedente();
    const res = await request(app).post('/api/account/deposit').set('Authorization', `Bearer ${token}`).send({ valor: 5000 });
    expect(res.status).toBe(200);
  });

  it('rota de conta que não é de dinheiro não é afetada', async () => {
    const token = await cedente();
    process.env.NODE_ENV = 'production';
    delete process.env.SEED_DEMO_DATA;

    const res = await request(app).get('/api/account').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

describe('preflight: uma leitura só do que é real e do que é simulado', () => {
  it('modoDemonstracao segue NODE_ENV e a válvula de escape que o seed já documentou', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SEED_DEMO_DATA;
    expect(modoDemonstracao()).toBe(false);
    process.env.SEED_DEMO_DATA = 'true';
    expect(modoDemonstracao()).toBe(true);
  });

  it('em produção sem PSP, o veredito é "não pode mover dinheiro" e lista os bloqueados', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SEED_DEMO_DATA;
    const p = prontidao();
    expect(p.modo).toBe('producao');
    expect(p.podeMoverDinheiro).toBe(false);
    expect(p.bloqueados).toEqual(['pix', 'boleto', 'ted', 'stablecoin']);
    expect(resumoDeBoot()).toMatch(/ATENÇÃO/);
  });

  it('em demonstração nada é bloqueado, e o resumo diz que é por desenho', () => {
    process.env.NODE_ENV = 'production';
    process.env.SEED_DEMO_DATA = 'true';
    expect(prontidao().bloqueados).toEqual([]);
    expect(resumoDeBoot()).toMatch(/modo demonstração/);
  });

  it('todo trilho de dinheiro tem rota mapeada no trinco — e vice-versa', async () => {
    // A guarda contra o esquecimento óbvio: alguém acrescenta um quinto trilho em
    // trilhosDeDinheiro() e não mapeia a rota, ou mapeia a rota e não declara o trilho. Nos dois
    // casos o dinheiro passa por um caminho que ninguém está guardando.
    process.env.NODE_ENV = 'production';
    delete process.env.SEED_DEMO_DATA;
    const token = await cedente();
    const rotaPorTrilho: Record<string, string> = {
      pix: '/api/account/deposit',
      boleto: '/api/account/deposit/boleto',
      ted: '/api/account/deposit/ted',
      stablecoin: '/api/account/deposit/stablecoin',
    };
    expect(Object.keys(rotaPorTrilho).sort()).toEqual(trilhosDeDinheiro().map((t) => t.chave).sort());
    for (const [chave, rota] of Object.entries(rotaPorTrilho)) {
      const res = await request(app).post(rota).set('Authorization', `Bearer ${token}`).send({ valor: 5000 });
      expect(res.status, `${rota} deveria estar bloqueada em produção`).toBe(503);
      expect(res.body.trilho, `${rota} deveria reportar o trilho ${chave}`).toBe(chave);
    }
  });

  it('toda integração declarada diz o que perde quem não a configurar', () => {
    for (const i of prontidao().integracoes) {
      expect(i.nome).toBeTruthy();
      expect(i.envs.length, `${i.chave} não diz qual env var o habilita`).toBeGreaterThan(0);
      expect(i.semEle.length, `${i.chave} não diz o que acontece sem ele`).toBeGreaterThan(10);
    }
  });
});
