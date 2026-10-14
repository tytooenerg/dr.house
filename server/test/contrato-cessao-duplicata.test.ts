import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { vencimentoFuturo } from './helpers/datas.js';

// Regressão: o instrumento de cessão (POST /api/uploads com kind='contrato_cessao') não
// tinha nenhuma ligação com a duplicata que ele comprova — só ficava preso à conta de quem
// enviou. Isso cobre o vínculo real: duplicataId informado no upload aparece depois em
// GET /api/minhas, e uma conta não pode anexar documento à duplicata de outra.

const MINIMAL_PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerCedente() {
  const email = `cessao-${unique()}@example.com`;
  const res = await request(app).post('/api/auth/register').send({
    nome: 'Cedente Cessão',
    email,
    password: 'senha123',
    companyName: `Empresa Cessão ${unique()}`,
    role: 'cedente',
  });
  return res.body.token as string;
}

// A registradora simula uma instabilidade de ~12% (lib/registradoras.ts) — mesmo retry que
// test/emitir.test.ts já usa pra não deixar isso virar flake.
async function emitirDuplicata(token: string) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({ sacado: `Sacado Cessão ${unique()}`, cnpj: '', valor: '10.000', vencimento: vencimentoFuturo(), seguro: false, nfAnexada: false, batchValores: [] });
    if (res.status === 200) return res.body.duplicataId as string;
    expect(res.status).toBe(502);
  }
  throw new Error('emitirDuplicata: falhou 10x seguidas — não deveria acontecer com 12% de chance de falha.');
}

describe('instrumento de cessão vinculado a uma duplicata', () => {
  it('um upload com duplicataId aparece depois em GET /api/minhas, vinculado àquela duplicata', async () => {
    const token = await registerCedente();
    const duplicataId = await emitirDuplicata(token);

    const upload = await request(app)
      .post('/api/uploads')
      .set('Authorization', `Bearer ${token}`)
      .field('kind', 'contrato_cessao')
      .field('duplicataId', duplicataId)
      .attach('file', MINIMAL_PDF, { filename: 'instrumento-cessao.pdf', contentType: 'application/pdf' });
    expect(upload.status).toBe(201);
    expect(upload.body.upload.duplicataId).toBe(duplicataId);

    const minhas = await request(app).get('/api/minhas').set('Authorization', `Bearer ${token}`);
    expect(minhas.status).toBe(200);
    const d = minhas.body.duplicatas.find((x: { id: string }) => x.id === duplicataId);
    expect(d.contratoCessaoAnexado).toBe(true);
    expect(d.contratoCessaoFilename).toBe('instrumento-cessao.pdf');
  });

  it('sem duplicataId, o upload continua funcionando como antes e nenhuma duplicata aparece com o documento anexado', async () => {
    const token = await registerCedente();
    const duplicataId = await emitirDuplicata(token);

    const upload = await request(app)
      .post('/api/uploads')
      .set('Authorization', `Bearer ${token}`)
      .field('kind', 'contrato_cessao')
      .attach('file', MINIMAL_PDF, { filename: 'contrato-generico.pdf', contentType: 'application/pdf' });
    expect(upload.status).toBe(201);
    expect(upload.body.upload.duplicataId).toBeNull();

    const minhas = await request(app).get('/api/minhas').set('Authorization', `Bearer ${token}`);
    const d = minhas.body.duplicatas.find((x: { id: string }) => x.id === duplicataId);
    expect(d.contratoCessaoAnexado).toBe(false);
  });

  it('recusa anexar documento a uma duplicata que não pertence à conta', async () => {
    const tokenA = await registerCedente();
    const duplicataDeA = await emitirDuplicata(tokenA);

    const tokenB = await registerCedente();
    const upload = await request(app)
      .post('/api/uploads')
      .set('Authorization', `Bearer ${tokenB}`)
      .field('kind', 'contrato_cessao')
      .field('duplicataId', duplicataDeA)
      .attach('file', MINIMAL_PDF, { filename: 'tentativa.pdf', contentType: 'application/pdf' });
    expect(upload.status).toBe(404);
    expect(upload.body.error).toBe('duplicata_not_found');
  });

  it('recusa um duplicataId que não existe', async () => {
    const token = await registerCedente();
    const upload = await request(app)
      .post('/api/uploads')
      .set('Authorization', `Bearer ${token}`)
      .field('kind', 'contrato_cessao')
      .field('duplicataId', 'DUP-INEXISTENTE')
      .attach('file', MINIMAL_PDF, { filename: 'contrato.pdf', contentType: 'application/pdf' });
    expect(upload.status).toBe(404);
    expect(upload.body.error).toBe('duplicata_not_found');
  });
});
