import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { db } from '../src/db/index.js';
import { vencimentoFuturo } from './helpers/datas.js';

// Duplicata lastreada em NFS-e (prestação de serviço), não NF-e (mercadoria). Diferente da
// NF-e, não existe chave de acesso nacional nem dígito verificador único pra NFS-e — cada
// município emite e verifica a sua própria nota. tipoDocumento='servico' (emitirCore.ts)
// reflete essa realidade: aceita um código de verificação em texto livre, sem exigir 44
// dígitos e sem gerar o alerta de "dígito verificador" que só faz sentido pra NF-e.

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerCedente() {
  const email = `ced-nfse-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente NFS-e', email, password: 'senha123', companyName: `Empresa NFS-e ${unique()}`, role: 'cedente' });
  return res.body.token as string;
}

function alertsFor(duplicataId: string) {
  return db.prepare('SELECT type, severity, message FROM compliance_alerts WHERE duplicata_id = ?').all(duplicataId) as {
    type: string;
    severity: string;
    message: string;
  }[];
}

describe('checklist de lastro — NFS-e (tipoDocumento=servico)', () => {
  it('o item de nota fiscal vira "NFS-e anexada e vinculada", sem exigir o dígito verificador da NF-e', async () => {
    const token = await registerCedente();
    const res = await request(app)
      .post('/api/emitir/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sacado: 'Grupo Atlas Varejo',
        cnpj: '12.345.678/0001-95',
        valor: '50.000',
        vencimento: '2026-09-01',
        seguro: false,
        tipoDocumento: 'servico',
        nfAnexada: true,
        nfeChave: 'ABC123-verificacao-municipal',
        comprovanteEntregaAnexado: true,
        pedidoCompraAnexado: true,
        batchValores: [],
      });
    expect(res.status).toBe(200);
    const items: { label: string; done: boolean }[] = res.body.lastroChecklist.items;
    const item = items.find((i) => i.label.includes('anexada e vinculada'));
    expect(item?.label).toBe('NFS-e anexada e vinculada');
    expect(item?.done).toBe(true);
    expect(res.body.lastroChecklist.pct).toBe(100);
  });

  it('continua "NF-e anexada e vinculada" quando tipoDocumento é produto (ou omitido)', async () => {
    const token = await registerCedente();
    const res = await request(app)
      .post('/api/emitir/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({ sacado: '', cnpj: '', valor: '', vencimento: '', seguro: false, nfAnexada: false, batchValores: [] });
    expect(res.status).toBe(200);
    const items: { label: string }[] = res.body.lastroChecklist.items;
    expect(items.find((i) => i.label.includes('anexada e vinculada'))?.label).toBe('NF-e anexada e vinculada');
  });

  it('aceita um código de verificação em texto livre (não-numérico, menos de 44 caracteres) sem erro de validação', async () => {
    const token = await registerCedente();
    let res = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sacado: `Sacado NFS-e ${unique()}`,
        cnpj: '',
        valor: '8.000',
        vencimento: vencimentoFuturo(),
        seguro: false,
        tipoDocumento: 'servico',
        nfAnexada: true,
        nfeChave: 'RPS-2026-000123/SP',
        batchValores: [],
      });
    for (let i = 0; i < 8 && res.status !== 200; i++) {
      res = await request(app)
        .post('/api/emitir/submit')
        .set('Authorization', `Bearer ${token}`)
        .send({
          sacado: `Sacado NFS-e ${unique()}`,
          cnpj: '',
          valor: '8.000',
          vencimento: vencimentoFuturo(),
          seguro: false,
          tipoDocumento: 'servico',
          nfAnexada: true,
          nfeChave: `RPS-2026-${i}/SP`,
          batchValores: [],
        });
    }
    expect(res.status).toBe(200);

    // Nenhum alerta de "dígito verificador" — esse eixo não existe pra NFS-e.
    const alerts = alertsFor(res.body.duplicataId);
    expect(alerts.find((a) => a.type === 'nfe_chave_invalida')).toBeUndefined();
    expect(alerts.find((a) => a.type === 'nfe_situacao_irregular')).toBeUndefined();
  });

  it('a mesma rejeição de 44-dígitos obrigatórios NÃO se aplica a tipoDocumento=servico', async () => {
    const token = await registerCedente();
    const res = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sacado: `Sacado NFS-e ${unique()}`,
        cnpj: '',
        valor: '5.000',
        vencimento: vencimentoFuturo(),
        seguro: false,
        tipoDocumento: 'servico',
        nfAnexada: false,
        nfeChave: 'curto',
        batchValores: [],
      });
    // Não é 400 por causa da chave curta (seria, para tipoDocumento='produto').
    expect(res.status).not.toBe(400);
  });

  // Regressão: a chave de NF-e é normalizada pra só dígitos antes da checagem de
  // duplicidade (nunca importa maiúscula/minúscula, porque só tem números). O código de
  // NFS-e é texto livre — sem normalizar caixa/espaços, "rps-123" e "RPS-123" passariam
  // como duas notas diferentes pro UNIQUE INDEX e pro findDuplicataByNfeChave, deixando a
  // mesma NFS-e lastrear duas duplicatas.
  it('detecta duplicidade de NFS-e mesmo com caixa/espaçamento diferentes', async () => {
    const token = await registerCedente();
    const codigo = `RPS-${unique()}`;

    let res = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sacado: `Sacado NFS-e Dup ${unique()}`,
        cnpj: '',
        valor: '5.000',
        vencimento: vencimentoFuturo(),
        seguro: false,
        tipoDocumento: 'servico',
        nfAnexada: true,
        nfeChave: codigo,
        batchValores: [],
      });
    for (let i = 0; i < 8 && res.status !== 200; i++) {
      res = await request(app)
        .post('/api/emitir/submit')
        .set('Authorization', `Bearer ${token}`)
        .send({
          sacado: `Sacado NFS-e Dup ${unique()}`,
          cnpj: '',
          valor: '5.000',
          vencimento: vencimentoFuturo(),
          seguro: false,
          tipoDocumento: 'servico',
          nfAnexada: true,
          nfeChave: codigo,
          batchValores: [],
        });
    }
    expect(res.status).toBe(200);

    // Mesmo código, só em caixa diferente e com espaço extra nas bordas (trim + uppercase
    // precisam tratar isso como idêntico ao original).
    const codigoRecaseado = `  ${codigo.toLowerCase()}  `;
    const segunda = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sacado: `Sacado NFS-e Dup 2 ${unique()}`,
        cnpj: '',
        valor: '5.000',
        vencimento: vencimentoFuturo(),
        seguro: false,
        tipoDocumento: 'servico',
        nfAnexada: true,
        nfeChave: codigoRecaseado,
        batchValores: [],
      });
    expect(segunda.status).toBe(409);
    expect(segunda.body.error).toBe('nfe_duplicidade');
  });
});
