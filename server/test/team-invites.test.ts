import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerCedente(companyName: string) {
  const email = `owner-${unique()}@example.com`;
  const res = await request(app).post('/api/auth/register').send({
    nome: 'Dono da Conta',
    email,
    password: 'senha123',
    companyName,
    role: 'cedente',
  });
  return { token: res.body.token as string, email };
}

function tokenFromInviteUrl(inviteUrl: string): string {
  return new URL(inviteUrl).searchParams.get('token')!;
}

async function submitEmitir(token: string) {
  let lastStatus = 0;
  let body: Record<string, unknown> = {};
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sacado: 'Grupo Atlas Varejo',
        cnpj: '12.345.678/0001-90',
        valor: '10.000',
        vencimento: '2026-11-01',
        seguro: false,
        nfAnexada: true,
        batchValores: [],
      });
    lastStatus = res.status;
    body = res.body;
    if (res.status === 200) break;
    expect(res.status).toBe(502);
  }
  expect(lastStatus).toBe(200);
  return body as { duplicataId: string };
}

describe('Real team invites', () => {
  it('creates a real, login-capable account on acceptance and grants read-only scoped access', async () => {
    const owner = await registerCedente(`Fornecedora Equipe ${unique()} Ltda`);
    const inviteEmail = `membro-${unique()}@example.com`;

    const invite = await request(app)
      .post('/api/profile/team/invite')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ nome: 'Membro Convidado', email: inviteEmail });
    expect(invite.status).toBe(200);
    expect(invite.body.inviteUrl).toMatch(/token=/);
    const pending = (invite.body.teamMembers as { email: string; status: string }[]).find((m) => m.email === inviteEmail);
    expect(pending?.status).toBe('pending');

    const token = tokenFromInviteUrl(invite.body.inviteUrl);

    // Wrong/garbage token is rejected.
    const badAccept = await request(app).post('/api/auth/team-invite/accept').send({ token: 'not-a-real-token-1234567890', password: 'senha123' });
    expect(badAccept.status).toBe(400);

    const accept = await request(app).post('/api/auth/team-invite/accept').send({ token, password: 'senha123' });
    expect(accept.status).toBe(201);
    expect(accept.body.token).toBeTruthy();
    expect(accept.body.user.role).toBe('cedente');
    expect(accept.body.user.isTeamMember).toBe(true);
    // Nav is scoped down to the read-only screens, not the owner's full cedente nav.
    expect(accept.body.user.navTabs).toEqual(expect.arrayContaining(['dashboard', 'minhas', 'historico', 'receita', 'perfil']));
    expect(accept.body.user.navTabs).not.toContain('emitir');
    const memberToken = accept.body.token as string;

    // A second acceptance of the same (now-consumed) token fails.
    const secondAccept = await request(app).post('/api/auth/team-invite/accept').send({ token, password: 'outrasenha' });
    expect(secondAccept.status).toBe(400);

    // Owner emits a duplicata — the team member sees it via the owner-scoped read.
    const emitted = await submitEmitir(owner.token);
    const membroMinhas = await request(app).get('/api/minhas').set('Authorization', `Bearer ${memberToken}`);
    expect(membroMinhas.status).toBe(200);
    expect((membroMinhas.body.duplicatas as { id: string }[]).some((d) => d.id === emitted.duplicataId)).toBe(true);

    // Read-only: a GET outside the allowed screens is refused…
    const blockedRead = await request(app).get('/api/market').set('Authorization', `Bearer ${memberToken}`);
    expect(blockedRead.status).toBe(403);
    // …and so is any write, even inside an allowed screen's own router.
    const blockedWrite = await request(app).post(`/api/minhas/${emitted.duplicataId}/leilao`).set('Authorization', `Bearer ${memberToken}`);
    expect(blockedWrite.status).toBe(403);

    // Self-service writes (own profile) still work.
    const selfService = await request(app).post('/api/profile/field').set('Authorization', `Bearer ${memberToken}`).send({ field: 'telefone', value: '11999999999' });
    expect(selfService.status).toBe(200);
  });

  it('revokes access immediately, even with a still-valid access token', async () => {
    const owner = await registerCedente(`Fornecedora Revogar ${unique()} Ltda`);
    const inviteEmail = `revoke-${unique()}@example.com`;
    const invite = await request(app)
      .post('/api/profile/team/invite')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ nome: 'Membro a Revogar', email: inviteEmail });
    const token = tokenFromInviteUrl(invite.body.inviteUrl);
    const accept = await request(app).post('/api/auth/team-invite/accept').send({ token, password: 'senha123' });
    const memberToken = accept.body.token as string;
    const memberId = (invite.body.teamMembers as { email: string; id: number }[]).find((m) => m.email === inviteEmail)!.id;

    const beforeRevoke = await request(app).get('/api/dashboard').set('Authorization', `Bearer ${memberToken}`);
    expect(beforeRevoke.status).toBe(200);

    const revoke = await request(app).post(`/api/profile/team/${memberId}/revoke`).set('Authorization', `Bearer ${owner.token}`);
    expect(revoke.status).toBe(200);
    const revoked = (revoke.body.teamMembers as { id: number; status: string }[]).find((m) => m.id === memberId);
    expect(revoked?.status).toBe('revoked');

    const afterRevoke = await request(app).get('/api/dashboard').set('Authorization', `Bearer ${memberToken}`);
    expect(afterRevoke.status).toBe(401);
  });

  it('refuses to accept an invite for an email that already has an account', async () => {
    const owner = await registerCedente(`Fornecedora Duplicada ${unique()} Ltda`);
    const existing = await registerCedente(`Outra Empresa ${unique()} Ltda`);

    const invite = await request(app)
      .post('/api/profile/team/invite')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ nome: 'Já Cadastrado', email: existing.email });
    const token = tokenFromInviteUrl(invite.body.inviteUrl);
    const accept = await request(app).post('/api/auth/team-invite/accept').send({ token, password: 'senha123' });
    expect(accept.status).toBe(409);
  });
});
