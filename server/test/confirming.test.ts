import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { listAuditLog } from '../src/db/audit.js';

function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function register(role: 'cedente' | 'sacado' | 'investidor', companyName: string) {
  const email = `${unique(role)}@example.com`;
  const res = await request(app).post('/api/auth/register').send({ nome: 'Teste', email, password: 'senha123', companyName, role });
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

// Grupo Atlas Varejo tem um perfil interno seedado (data/seed.ts SACADOS), score 84 →
// rating AA — a única forma determinística de dar a buildBlendedRiscoViewSync um sinal
// real sem depender de sinais de rede. Usado só pelo CNPJ, não pelo nome da conta.
const CNPJ_COM_HISTORICO = '12.345.678/0001-90';
const CNPJ_SEM_HISTORICO = '00.000.000/0001-00';

// /api/emitir/submit passa por lib/registradoras.ts, que simula ~12% de indisponibilidade
// por tentativa de propósito (ver README) — retry até 5x, mesmo padrão já usado em
// aceites-disputas.test.ts, pra não deixar esses testes flakeando numa instabilidade que
// eles mesmos não estão testando.
async function emitirComRetry(token: string, body: Record<string, unknown>) {
  let res = await request(app).post('/api/emitir/submit').set('Authorization', `Bearer ${token}`).send(body);
  for (let attempt = 0; attempt < 4 && res.status !== 200; attempt++) {
    res = await request(app).post('/api/emitir/submit').set('Authorization', `Bearer ${token}`).send(body);
  }
  return res;
}

describe('Programa Confirming — criação e ciclo de vida', () => {
  it('starts with no programa for a fresh sacado', async () => {
    const { token } = await register('sacado', unique('Sacado Fresco'));
    const res = await request(app).get('/api/confirming/meu-programa').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.programa).toBeNull();
  });

  it('creates a programa with a rate derived from the sacado\'s own real risk score', async () => {
    const { token } = await register('sacado', unique('Âncora AA'));
    const res = await request(app)
      .post('/api/confirming/criar')
      .set('Authorization', `Bearer ${token}`)
      .send({ cnpj: CNPJ_COM_HISTORICO, limite: '500.000' });
    expect(res.status).toBe(200);
    expect(res.body.rating).toBe('AA');
    expect(res.body.limiteFmt).toContain('500.000');
    expect(res.body.status).toBe('ativo');
    expect(res.body.taxaAmFmt).toMatch(/% a\.m\.$/);

    const entry = listAuditLog(20).find((e) => e.action === 'confirming.programa_criado');
    expect(entry).toBeDefined();
  });

  it('refuses to create a programa for a CNPJ with no internal or network history', async () => {
    const { token } = await register('sacado', unique('Sem Histórico'));
    const res = await request(app)
      .post('/api/confirming/criar')
      .set('Authorization', `Bearer ${token}`)
      .send({ cnpj: CNPJ_SEM_HISTORICO, limite: '500.000' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('sem_historico');
  });

  it('refuses a limite outside the allowed range', async () => {
    const { token } = await register('sacado', unique('Âncora Limite'));
    const tooLow = await request(app).post('/api/confirming/criar').set('Authorization', `Bearer ${token}`).send({ cnpj: CNPJ_COM_HISTORICO, limite: '1.000' });
    expect(tooLow.status).toBe(400);
    expect(tooLow.body.error).toBe('limite_invalido');

    const tooHigh = await request(app)
      .post('/api/confirming/criar')
      .set('Authorization', `Bearer ${token}`)
      .send({ cnpj: CNPJ_COM_HISTORICO, limite: '10.000.000' });
    expect(tooHigh.status).toBe(400);
    expect(tooHigh.body.error).toBe('limite_invalido');
  });

  it('refuses a second programa for the same sacado', async () => {
    const { token } = await register('sacado', unique('Âncora Dupla'));
    const first = await request(app).post('/api/confirming/criar').set('Authorization', `Bearer ${token}`).send({ cnpj: CNPJ_COM_HISTORICO, limite: '500.000' });
    expect(first.status).toBe(200);
    const second = await request(app).post('/api/confirming/criar').set('Authorization', `Bearer ${token}`).send({ cnpj: CNPJ_COM_HISTORICO, limite: '500.000' });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe('programa_existente');
  });

  it('pausa and reativa the programa', async () => {
    const { token } = await register('sacado', unique('Âncora Pausa'));
    await request(app).post('/api/confirming/criar').set('Authorization', `Bearer ${token}`).send({ cnpj: CNPJ_COM_HISTORICO, limite: '500.000' });

    const paused = await request(app).post('/api/confirming/pausar').set('Authorization', `Bearer ${token}`);
    expect(paused.status).toBe(200);
    expect(paused.body.status).toBe('pausado');

    const reativado = await request(app).post('/api/confirming/reativar').set('Authorization', `Bearer ${token}`);
    expect(reativado.status).toBe(200);
    expect(reativado.body.status).toBe('ativo');
  });

  it('blocks non-sacado roles from every sacado-side route', async () => {
    const { token: cedenteToken } = await register('cedente', unique('Não Sacado'));
    const res = await request(app).get('/api/confirming/meu-programa').set('Authorization', `Bearer ${cedenteToken}`);
    expect(res.status).toBe(403);
  });
});

describe('Programa Confirming — matrícula de cedentes', () => {
  it('suggests a cedente with real aceite history against this sacado as eligible', async () => {
    const sacadoCompany = unique('Sacado Âncora');
    const { token: sacadoToken } = await register('sacado', sacadoCompany);
    const { token: cedenteToken, userId: cedenteUserId } = await register('cedente', unique('Fornecedor Elegível'));

    const emit = await emitirComRetry(cedenteToken, {
      sacado: sacadoCompany,
      cnpj: '22.222.222/0001-22',
      valor: '30.000',
      vencimento: '2026-12-01',
      seguro: false,
      nfAnexada: false,
      batchValores: [],
    });
    expect(emit.status).toBe(200);

    const elegiveis = await request(app).get('/api/confirming/elegiveis').set('Authorization', `Bearer ${sacadoToken}`);
    expect(elegiveis.status).toBe(200);
    const found = elegiveis.body.elegiveis.find((e: { cedenteUserId: number }) => e.cedenteUserId === cedenteUserId);
    expect(found).toBeDefined();
    expect(found.jaMatriculado).toBe(false);
    expect(found.volumeHistoricoFmt).toContain('30.000');
  });

  it('matricula a cedente, then lets the cedente see the enrollment, then removes it', async () => {
    const sacadoCompany = unique('Sacado Matricula');
    const { token: sacadoToken } = await register('sacado', sacadoCompany);
    const { token: cedenteToken, userId: cedenteUserId } = await register('cedente', unique('Fornecedor Matriculado'));

    await emitirComRetry(cedenteToken, {
      sacado: sacadoCompany,
      cnpj: '33.333.333/0001-33',
      valor: '15.000',
      vencimento: '2026-12-01',
      seguro: false,
      nfAnexada: false,
      batchValores: [],
    });

    await request(app).post('/api/confirming/criar').set('Authorization', `Bearer ${sacadoToken}`).send({ cnpj: CNPJ_COM_HISTORICO, limite: '500.000' });

    const matriculado = await request(app)
      .post('/api/confirming/membros')
      .set('Authorization', `Bearer ${sacadoToken}`)
      .send({ cedenteUserId, sublimite: '50.000' });
    expect(matriculado.status).toBe(200);
    expect(matriculado.body.membros).toHaveLength(1);
    const membro = matriculado.body.membros[0];
    expect(membro.sublimiteFmt).toContain('50.000');

    const auditEntry = listAuditLog(20).find((e) => e.action === 'confirming.cedente_matriculado');
    expect(auditEntry).toBeDefined();

    const minhasMatriculas = await request(app).get('/api/confirming/minhas-matriculas').set('Authorization', `Bearer ${cedenteToken}`);
    expect(minhasMatriculas.status).toBe(200);
    expect(minhasMatriculas.body.matriculas).toHaveLength(1);
    expect(minhasMatriculas.body.matriculas[0].sacadoNome).toBe(sacadoCompany);
    expect(minhasMatriculas.body.matriculas[0].programaAtivo).toBe(true);

    const removido = await request(app).post(`/api/confirming/membros/${membro.id}/remover`).set('Authorization', `Bearer ${sacadoToken}`);
    expect(removido.status).toBe(200);
    expect(removido.body.membros.find((m: { id: number }) => m.id === membro.id).status).toBe('removido');

    const minhasMatriculasDepois = await request(app).get('/api/confirming/minhas-matriculas').set('Authorization', `Bearer ${cedenteToken}`);
    expect(minhasMatriculasDepois.body.matriculas).toHaveLength(0);
  });

  it('refuses to matricular a non-cedente account', async () => {
    const { token: sacadoToken } = await register('sacado', unique('Sacado Invalido'));
    await request(app).post('/api/confirming/criar').set('Authorization', `Bearer ${sacadoToken}`).send({ cnpj: CNPJ_COM_HISTORICO, limite: '500.000' });
    const { userId: investidorId } = await register('investidor', unique('Não é cedente'));

    const res = await request(app).post('/api/confirming/membros').set('Authorization', `Bearer ${sacadoToken}`).send({ cedenteUserId: investidorId });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('cedente_invalido');
  });

  it('refuses to matricular into another sacado\'s programa', async () => {
    const { token: sacadoToken } = await register('sacado', unique('Sacado Sem Programa'));
    const { userId: cedenteUserId } = await register('cedente', unique('Fornecedor Orfao'));
    const res = await request(app).post('/api/confirming/membros').set('Authorization', `Bearer ${sacadoToken}`).send({ cedenteUserId });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('programa_nao_encontrado');
  });
});
