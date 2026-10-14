import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { getUserById, getSettings } from '../src/db/users.js';
import { listNotifications } from '../src/db/misc.js';
import { vencimentoFuturo } from './helpers/datas.js';

// Etapa 2 de "facilitar a vida da empresa": CNPJ e WhatsApp no cadastro, documentos num
// lugar só (sem o checklist de mentira da Conta), aviso de aprovação/recusa, guia de
// primeiros passos com progresso real e onboarding sem o "Bem-vinda, Marina" fixo.

beforeAll(async () => {
  await seedIfEmpty();
});

const CNPJ = '11.444.777/0001-61';
const MINIMAL_PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function registrar(extra: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/auth/register')
    .send({ nome: 'Joana Prado', email: `cad-${unique()}@example.com`, password: 'senha123', companyName: `Padaria ${unique()} Ltda`, role: 'cedente', ...extra });
}

async function adminToken() {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

describe('cadastro com CNPJ e WhatsApp', () => {
  it('CNPJ inválido é recusado; o válido fica guardado para o credenciamento', async () => {
    expect((await registrar({ cnpj: '11.111.111/1111-11' })).status).toBe(400);
    const ok = await registrar({ cnpj: CNPJ, telefone: '(11) 98888-7777', whatsapp: true });
    expect(ok.status).toBe(201);
    expect(ok.body.user.kybForm.cnpj).toBe(CNPJ);
    const u = getUserById(ok.body.user.id)!;
    expect(u.telefone).toBe('11988887777');
    expect(getSettings(u).notifyViaWhatsapp).toBe(true);
  });

  it('sem marcar WhatsApp, o telefone é guardado mas os avisos não vão por WhatsApp', async () => {
    const ok = await registrar({ cnpj: CNPJ, telefone: '11988887777', whatsapp: false });
    expect(getSettings(getUserById(ok.body.user.id)!).notifyViaWhatsapp).toBe(false);
  });

  it('a API continua aceitando cadastro sem CNPJ (parceiros, SDKs)', async () => {
    expect((await registrar()).status).toBe(201);
  });

  it('GET /public/cnpj confere o dígito e diz quando não houve consulta real à Receita', async () => {
    expect((await request(app).get('/api/public/cnpj/11111111111111')).body).toMatchObject({ valido: false });
    expect((await request(app).get(`/api/public/cnpj/${encodeURIComponent(CNPJ)}`)).body).toEqual({
      valido: true,
      consultaReal: false,
      razaoSocial: null,
      situacao: null,
      ativo: null,
    });
  });

  it('o onboarding cumprimenta pelo primeiro nome, não "Marina"', async () => {
    const ok = await registrar();
    expect(ok.body.user.onboardingSteps[0].title).toBe('Boas-vindas, Joana');
    expect(JSON.stringify(ok.body.user.onboardingSteps)).not.toContain('Marina');
  });
});

describe('documentos da empresa num lugar só', () => {
  it('a Conta mostra o credenciamento real, e o envio falso de documentos não existe mais', async () => {
    const { body } = await registrar({ cnpj: CNPJ });
    const token = body.token as string;
    const conta = await request(app).get('/api/account').set('Authorization', `Bearer ${token}`);
    const [cnpjItem, docs] = conta.body.kycChecklist;
    expect(cnpjItem).toMatchObject({ label: 'CNPJ da empresa', status: 'Concluído', action: null });
    expect(docs).toMatchObject({ status: 'Pendente', action: { key: 'kyb' } });
    expect((await request(app).post('/api/account/kyc/docs').set('Authorization', `Bearer ${token}`)).status).toBe(404);

    for (const kind of ['kyb_cedente_cnpj', 'kyb_cedente_contrato_social', 'kyb_cedente_representante']) {
      await request(app).post('/api/uploads').set('Authorization', `Bearer ${token}`).field('kind', kind).attach('file', MINIMAL_PDF, { filename: `${kind}.pdf`, contentType: 'application/pdf' });
    }
    expect((await request(app).post('/api/auth/kyb/cedente').set('Authorization', `Bearer ${token}`).send({ cnpj: CNPJ })).status).toBe(200);
    const depois = await request(app).get('/api/account').set('Authorization', `Bearer ${token}`);
    expect(depois.body.kycChecklist[1]).toMatchObject({ status: 'Em análise (até 2 dias úteis)', action: null });
  });

  it('a empresa é avisada quando o admin aprova ou recusa', async () => {
    const admin = await adminToken();
    const a = (await registrar({ cnpj: CNPJ })).body;
    await request(app).post(`/api/admin/kyb/${a.user.id}/approve`).set('Authorization', `Bearer ${admin}`).expect(200);
    expect(listNotifications(a.user.id).some((n) => n.text.includes('Documentos da empresa aprovados'))).toBe(true);

    const b = (await registrar({ cnpj: CNPJ })).body;
    await request(app).post(`/api/admin/kyb/${b.user.id}/reject`).set('Authorization', `Bearer ${admin}`).send({ reason: 'Contrato social ilegível' }).expect(200);
    expect(listNotifications(b.user.id).some((n) => n.text.includes('Documentos recusados: Contrato social ilegível'))).toBe(true);
  });
});

describe('guia "seu primeiro dinheiro em 4 passos"', () => {
  it('reflete o estado real e avança conforme a empresa faz cada passo', async () => {
    const { body } = await registrar({ cnpj: CNPJ });
    const token = body.token as string;
    const guia = async () => (await request(app).get('/api/dashboard').set('Authorization', `Bearer ${token}`)).body.primeirosPassos;

    const inicio = await guia();
    expect(inicio.concluidos).toBe(0);
    expect(inicio.passos.map((p: { key: string }) => p.key)).toEqual(['documentos', 'pix', 'duplicata', 'aceite']);

    await request(app).post('/api/account/kyc/bank').set('Authorization', `Bearer ${token}`).send({ chave: CNPJ }).expect(200);
    for (let i = 0; i < 8; i++) {
      const r = await request(app)
        .post('/api/emitir/submit')
        .set('Authorization', `Bearer ${token}`)
        .send({ sacado: `Cliente ${unique()} Ltda`, cnpj: '', valor: '5.000', vencimento: vencimentoFuturo(30), seguro: false, batchValores: [] });
      if (r.status === 200) break;
    }
    const meio = await guia();
    expect(meio.passos.find((p: { key: string }) => p.key === 'pix').estado).toBe('feito');
    expect(meio.passos.find((p: { key: string }) => p.key === 'duplicata').estado).toBe('feito');
    expect(meio.passos.find((p: { key: string }) => p.key === 'aceite')).toMatchObject({ estado: 'em_andamento', estadoLabel: 'Aguardando o sacado' });
    expect(meio.concluidos).toBe(2);
  });

  it('não aparece para quem não é empresa', async () => {
    const inv = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Inv', email: `inv-${unique()}@example.com`, password: 'senha123', companyName: `Fundo ${unique()}`, role: 'investidor' });
    expect((await request(app).get('/api/dashboard').set('Authorization', `Bearer ${inv.body.token}`)).body.primeirosPassos).toBeNull();
  });

  it('o chat sugere à empresa as perguntas dela', async () => {
    const { body } = await registrar();
    const res = await request(app).get('/api/chat').set('Authorization', `Bearer ${body.token}`);
    expect(res.body.suggestions).toEqual(['Quanto vou receber?', 'Como peço o aceite do meu cliente?', 'Por que minha duplicata está pendente?']);
  });
});
