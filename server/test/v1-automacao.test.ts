import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import http from 'node:http';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { ensureAceite, setAceiteStatus } from '../src/db/aceites.js';
import { getDuplicata } from '../src/db/duplicatas.js';

// A porta de entrada de uma automação externa (o n8n do cedente) no ciclo da duplicata.
// Até aqui a API pública emitia e parava: dava pra criar a duplicata pela integração e não
// havia como levá-la ao leilão nem como listar o que já fora emitido.

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function cedenteEmpresarial() {
  const email = `ced-n8n-${unique()}@example.com`;
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente n8n', email, password: 'senha123', companyName: `Cedente n8n ${unique()}`, role: 'cedente' });
  const token = reg.body.token as string;
  // A geração de chave de API vive atrás do /api/dev, que é Empresarial.
  await request(app).post('/api/billing/checkout').set('Authorization', `Bearer ${token}`).send({ plan: 'empresarial' });
  const gen = await request(app).post('/api/dev/keys/generate').set('Authorization', `Bearer ${token}`);
  return { token, userId: reg.body.user.id as number, key: gen.body.rawKey as string };
}

/**
 * Emite pela API e devolve o id. Duas coisas importam aqui:
 * - CNPJ do sacado + `nfAnexada` fecham os 5 itens do checklist de lastro (lib/emitirCore.ts),
 *   e é o lastro em 100% que faz a duplicata nascer 'aprovada' em vez de 'pendente_analise' —
 *   sem isso nada pode ir a leilão, com ou sem aceite;
 * - o registro na registradora é simulado e pode falhar com 502, então se repete. Cada
 *   tentativa que falha deixa a sua linha pra trás, e é por isso que os testes de listagem
 *   abaixo afirmam presença/ausência de ids em vez de contar o total.
 */
async function emitirPelaApi(key: string, valor = '5.000') {
  for (let tentativa = 0; tentativa < 8; tentativa++) {
    const res = await request(app)
      .post('/api/v1/duplicatas')
      .set('Authorization', `Bearer ${key}`)
      .send({ sacado: 'Grupo Atlas Varejo', cnpj: '58.442.111/0001-27', valor, vencimento: '2027-12-31', seguro: false, nfAnexada: true });
    if (res.status === 200) return res.body.duplicataId as string;
  }
  throw new Error('não consegui emitir pela API depois de 8 tentativas');
}

/** O sacado aceita — sem isso nenhuma duplicata pode ser negociada (lib/aceiteCore.ts). */
function confirmarAceite(duplicataId: string) {
  setAceiteStatus(ensureAceite(duplicataId, 'Aceite confirmado no teste').id, 'aceita');
}

describe('/api/v1 — listagem de duplicatas', () => {
  it('lista as duplicatas da própria conta, com total e paginação', async () => {
    const { key } = await cedenteEmpresarial();
    const a = await emitirPelaApi(key, '5.000');
    const b = await emitirPelaApi(key, '7.000');

    const res = await request(app).get('/api/v1/duplicatas').set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(200);
    const ids = res.body.duplicatas.map((d: { id: string }) => d.id);
    expect(ids).toContain(a);
    expect(ids).toContain(b);
    expect(res.body.total).toBe(ids.length);
    expect(res.body.mode).toBe('live');

    // Paginação de verdade: limit corta a página, total continua sendo o conjunto inteiro.
    const pagina = await request(app).get('/api/v1/duplicatas?limit=1').set('Authorization', `Bearer ${key}`);
    expect(pagina.body.duplicatas).toHaveLength(1);
    expect(pagina.body.total).toBe(res.body.total);
    expect(pagina.body.total).toBeGreaterThan(1);
  });

  it('filtra por status', async () => {
    const { key } = await cedenteEmpresarial();
    const id = await emitirPelaApi(key);
    const status = getDuplicata(id)!.status;

    const certo = await request(app).get(`/api/v1/duplicatas?status=${status}`).set('Authorization', `Bearer ${key}`);
    expect(certo.body.duplicatas.map((d: { id: string }) => d.id)).toContain(id);

    const errado = await request(app).get('/api/v1/duplicatas?status=paga').set('Authorization', `Bearer ${key}`);
    expect(errado.body.duplicatas.map((d: { id: string }) => d.id)).not.toContain(id);
  });

  it('nunca mistura os planos de dados: uma chave live não enxerga o que uma de teste emitiu', async () => {
    const { token, key: liveKey } = await cedenteEmpresarial();
    const gen = await request(app).post('/api/dev/keys/generate').set('Authorization', `Bearer ${token}`).send({ mode: 'test' });
    const testKey = gen.body.rawKey as string;
    // Só vale como prova se a chave gerada for mesmo de teste.
    expect(testKey.startsWith('lastro_test_')).toBe(true);

    const idLive = await emitirPelaApi(liveKey);
    const idTeste = await emitirPelaApi(testKey);
    expect(idLive).not.toBe(idTeste);

    const listaLive = await request(app).get('/api/v1/duplicatas').set('Authorization', `Bearer ${liveKey}`);
    const listaTeste = await request(app).get('/api/v1/duplicatas').set('Authorization', `Bearer ${testKey}`);
    const idsLive = listaLive.body.duplicatas.map((d: { id: string }) => d.id);
    const idsTeste = listaTeste.body.duplicatas.map((d: { id: string }) => d.id);
    expect(idsLive).toContain(idLive);
    expect(idsLive).not.toContain(idTeste);
    expect(idsTeste).toContain(idTeste);
    expect(idsTeste).not.toContain(idLive);
    expect(listaTeste.body.mode).toBe('test');
  });

  it('recusa uma chave que não é de conta cedente', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Investidor', email: `inv-n8n-${unique()}@example.com`, password: 'senha123', companyName: 'Fundo n8n', role: 'investidor' });
    const token = reg.body.token as string;
    await request(app).post('/api/billing/checkout').set('Authorization', `Bearer ${token}`).send({ plan: 'empresarial' });
    const gen = await request(app).post('/api/dev/keys/generate').set('Authorization', `Bearer ${token}`);

    const res = await request(app).get('/api/v1/duplicatas').set('Authorization', `Bearer ${gen.body.rawKey}`);
    expect(res.status).toBe(403);
  });
});

describe('/api/v1 — abrir o leilão pela API', () => {
  it('leva a duplicata ao mercado com a reserva e a duração informadas', async () => {
    const { key } = await cedenteEmpresarial();
    const id = await emitirPelaApi(key);
    confirmarAceite(id);

    const res = await request(app)
      .post(`/api/v1/duplicatas/${id}/leilao`)
      .set('Authorization', `Bearer ${key}`)
      .send({ taxaMaxima: 2.5, duracaoHoras: 24 });
    expect(res.status).toBe(200);
    expect(res.body.duplicataId).toBe(id);
    expect(res.body.reservaTaxaAm).toBe(2.5);

    // O efeito é real, não só a resposta: a duplicata está no mercado com a reserva do
    // cedente gravada e um prazo de fechamento ~24h à frente.
    const d = getDuplicata(id)!;
    expect(d.status).toBe('no_mercado');
    expect(d.reserva_taxa_am).toBe(2.5);
    const horas = (new Date(d.close_at!).getTime() - Date.now()) / 3600_000;
    expect(horas).toBeGreaterThan(23);
    expect(horas).toBeLessThan(25);
  });

  it('recusa antes do aceite do sacado, e a duplicata não vai ao mercado', async () => {
    const { key } = await cedenteEmpresarial();
    const id = await emitirPelaApi(key);

    const res = await request(app).post(`/api/v1/duplicatas/${id}/leilao`).set('Authorization', `Bearer ${key}`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('aceite_pendente');
    expect(getDuplicata(id)!.status).not.toBe('no_mercado');
  });

  it('recusa uma reserva fora da faixa de sanidade e uma duração absurda', async () => {
    const { key } = await cedenteEmpresarial();
    const id = await emitirPelaApi(key);
    confirmarAceite(id);

    const taxa = await request(app).post(`/api/v1/duplicatas/${id}/leilao`).set('Authorization', `Bearer ${key}`).send({ taxaMaxima: 150 });
    expect(taxa.status).toBe(400);

    const duracao = await request(app).post(`/api/v1/duplicatas/${id}/leilao`).set('Authorization', `Bearer ${key}`).send({ duracaoHoras: 10_000 });
    expect(duracao.status).toBe(400);

    // Nenhuma das duas recusas pode ter aberto o leilão pela metade.
    expect(getDuplicata(id)!.status).not.toBe('no_mercado');
  });

  it('404 para a duplicata de outra conta — e não revela que ela existe', async () => {
    const dono = await cedenteEmpresarial();
    const estranho = await cedenteEmpresarial();
    const id = await emitirPelaApi(dono.key);
    confirmarAceite(id);

    const res = await request(app).post(`/api/v1/duplicatas/${id}/leilao`).set('Authorization', `Bearer ${estranho.key}`).send({});
    expect(res.status).toBe(404);
    expect(getDuplicata(id)!.status).not.toBe('no_mercado');
  });

  it('recusa uma chave somente-leitura', async () => {
    const { token, key } = await cedenteEmpresarial();
    const id = await emitirPelaApi(key);
    confirmarAceite(id);
    const gen = await request(app).post('/api/dev/keys/generate').set('Authorization', `Bearer ${token}`).send({ scope: 'read_only' });

    const res = await request(app).post(`/api/v1/duplicatas/${id}/leilao`).set('Authorization', `Bearer ${gen.body.rawKey}`).send({});
    expect(res.status).toBe(403);
    expect(getDuplicata(id)!.status).not.toBe('no_mercado');
  });
});

describe('a reserva que o investidor vê é a que o backend aplica', () => {
  it('mostra na oferta a reserva definida pelo cedente, não a taxa de mercado', async () => {
    // O campo `reservaTaxaAm` da oferta vinha de effectiveMonthlyRatePct — a taxa de MERCADO.
    // Um cedente que definia 4,5% via um investidor lendo "reserva" com o número da banda
    // (algo perto de 1,75%), e portanto deixando de dar lances entre os dois valores por
    // acreditar que seriam recusados — quando o backend os aceitaria.
    const { key } = await cedenteEmpresarial();
    const id = await emitirPelaApi(key);
    confirmarAceite(id);

    const RESERVA = 4.5;
    const abriu = await request(app)
      .post(`/api/v1/duplicatas/${id}/leilao`)
      .set('Authorization', `Bearer ${key}`)
      .send({ taxaMaxima: RESERVA });
    expect(abriu.status).toBe(200);

    const mercado = await request(app).get('/api/v1/marketplace').set('Authorization', `Bearer ${key}`);
    const oferta = mercado.body.offers.find((o: { id: string }) => o.id === id);
    expect(oferta).toBeTruthy();
    expect(oferta.reservaTaxaAm).toBe(RESERVA);
    expect(oferta.reservaTaxaFmt).toBe('4,50%');
    expect(oferta.reservaDoCedente).toBe(true);

    // E a taxa de mercado, que era o que aparecia ali, continua exposta no seu próprio campo —
    // a correção não apagou a informação, só parou de chamá-la de reserva.
    expect(oferta.desagio).not.toBe(oferta.reservaTaxaFmt);
  });

  it('sem reserva definida, cai na banda de mercado e diz que a reserva não é do cedente', async () => {
    const { key } = await cedenteEmpresarial();
    const id = await emitirPelaApi(key);
    confirmarAceite(id);
    await request(app).post(`/api/v1/duplicatas/${id}/leilao`).set('Authorization', `Bearer ${key}`).send({});

    const mercado = await request(app).get('/api/v1/marketplace').set('Authorization', `Bearer ${key}`);
    const oferta = mercado.body.offers.find((o: { id: string }) => o.id === id);
    expect(oferta.reservaDoCedente).toBe(false);
    expect(oferta.reservaTaxaFmt).toBe(oferta.desagio);
  });
});

describe("/api/v1 — 'leilao.aberto' chega a quem assinou, venha o leilão de onde vier", () => {
  /** Sobe um servidor real e registra o webhook; resolve com o corpo entregue. */
  async function ouvirWebhook(token: string) {
    let resolver!: (body: string) => void;
    const recebido = new Promise<string>((resolve) => (resolver = resolve));
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        res.writeHead(200);
        res.end('ok');
        resolver(raw);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const reg = await request(app)
      .post('/api/dev/webhooks')
      .set('Authorization', `Bearer ${token}`)
      .send({ url: `http://127.0.0.1:${port}/hook`, event: 'leilao.aberto' });
    expect(reg.status).toBe(200);
    return {
      server,
      esperar: () =>
        Promise.race([recebido, new Promise<string>((_, rej) => setTimeout(() => rej(new Error('webhook não chegou a tempo')), 5000))]),
    };
  }

  it('emite o evento quando o leilão é aberto pela API pública', async () => {
    const { token, key } = await cedenteEmpresarial();
    const id = await emitirPelaApi(key);
    confirmarAceite(id);
    const hook = await ouvirWebhook(token);

    const res = await request(app).post(`/api/v1/duplicatas/${id}/leilao`).set('Authorization', `Bearer ${key}`).send({ taxaMaxima: 2 });
    expect(res.status).toBe(200);

    const body = await hook.esperar();
    hook.server.close();
    expect(body).toContain('leilao.aberto');
    expect(body).toContain(id);
  });

  it('emite o evento quando quem abre o leilão é o Executar do motor de decisão do CFO', async () => {
    // Este é o caminho que NUNCA emitia: routes/cashflow.ts chamava dispararLeilao direto,
    // sem passar por lugar nenhum que anunciasse o evento. Quem assinasse 'leilao.aberto'
    // esperaria pra sempre pelos leilões abertos pela automação — justamente os que mais
    // interessam a quem integra.
    const { token, key } = await cedenteEmpresarial();
    const id = await emitirPelaApi(key, '80.000');
    confirmarAceite(id);
    const hook = await ouvirWebhook(token);

    const res = await request(app)
      .post('/api/cashflow/recomendacao/executar')
      .set('Authorization', `Bearer ${token}`)
      .send({ duplicataIds: [id], taxaMaxima: 3 });
    expect(res.status).toBe(200);
    expect(res.body.abertas).toContain(id);

    const body = await hook.esperar();
    hook.server.close();
    expect(body).toContain('leilao.aberto');
    expect(body).toContain(id);
  });
});

describe('/api/v1 — projeção de caixa para o supervisor externo', () => {
  it('devolve a projeção e a recomendação do motor de decisão', async () => {
    const { key } = await cedenteEmpresarial();
    const res = await request(app).get('/api/v1/cashflow').set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(200);
    expect(res.body.forecast).toBeTruthy();
    expect(res.body.recomendacao).toBeTruthy();
  });

  it('recusa uma chave de teste em vez de servir a posição financeira real sob ela', async () => {
    const { token } = await cedenteEmpresarial();
    const gen = await request(app).post('/api/dev/keys/generate').set('Authorization', `Bearer ${token}`).send({ mode: 'test' });

    const res = await request(app).get('/api/v1/cashflow').set('Authorization', `Bearer ${gen.body.rawKey}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('sandbox_indisponivel');
    // A recusa precisa ser explicada, não um erro seco: é isso que impede o integrador de
    // achar que a conta simplesmente não tem projeção de caixa.
    expect(res.body.message).toMatch(/sandbox/i);
  });
});
