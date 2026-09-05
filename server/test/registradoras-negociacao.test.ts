import { describe, expect, it, vi, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { getDuplicata } from '../src/db/duplicatas.js';
import { getAceiteByDuplicata, setAceiteStatus } from '../src/db/aceites.js';
import { approveKyb } from '../src/db/users.js';
import * as registradoras from '../src/lib/registradoras.js';
import { arrematar, darLance, fecharLeiloes } from './helpers/auction.js';

// Achado corrigido (auditoria de conformidade — Resolução BCB nº 540/2025): o sacador
// deve informar a registradora sobre atos de negociação da duplicata, não só registrar a
// emissão original. registrarNaRegistradora (chamada só em emitirCore.ts) nunca cobria
// isso — nada informava a registradora quando a duplicata de fato mudava de mãos.

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

describe('informarNegociacao — comportamento em isolamento (sem credencial real configurada)', () => {
  it('retorna confirmado simulado, claramente rotulado, quando há registradora conhecida mas sem API real configurada', async () => {
    const result = await registradoras.informarNegociacao({ registradoraKey: 'cerc', duplicataId: 'DUP-TESTE-1', evento: 'compra', valor: 1000 });
    expect(result).toEqual({ confirmado: true, simulado: true });
  });

  it('retorna não confirmado quando a duplicata não tem registradora conhecida (nunca finge sucesso)', async () => {
    const result = await registradoras.informarNegociacao({ registradoraKey: null, duplicataId: 'DUP-TESTE-2', evento: 'revenda', valor: 1000 });
    expect(result).toEqual({ confirmado: false, simulado: true });
  });
});

describe('informarNegociacao é chamada nos pontos reais de negociação, não só na emissão', () => {
  it('uma compra primária no mercado chama informarNegociacao com o evento "compra"', async () => {
    const spy = vi.spyOn(registradoras, 'informarNegociacao');
    const cedenteRes = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Cedente', email: `ced-negoc-${unique()}@example.com`, password: 'senha123', companyName: `Cedente Negoc ${unique()} Ltda`, role: 'cedente' });
    const cedenteToken = cedenteRes.body.token as string;
    const investorRes = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Investidor', email: `inv-negoc-${unique()}@example.com`, password: 'senha123', companyName: `Fundo Negoc ${unique()}`, role: 'investidor' });
    const investorToken = investorRes.body.token as string;
    approveKyb(investorRes.body.user.id);

    let duplicataId = '';
    for (let attempt = 0; attempt < 8 && !duplicataId; attempt++) {
      const res = await request(app)
        .post('/api/emitir/submit')
        .set('Authorization', `Bearer ${cedenteToken}`)
        .send({ sacado: `Sacado Negoc ${unique()} Ltda`, cnpj: '22.333.444/0001-55', valor: '35.000', vencimento: '2026-12-31', seguro: false, nfAnexada: true, batchValores: [] });
      if (res.status === 200) duplicataId = res.body.duplicataId;
    }
    expect(duplicataId).toBeTruthy();
    const registradoraKey = getDuplicata(duplicataId)!.registradora;
    setAceiteStatus(getAceiteByDuplicata(duplicataId)!.id, 'aceita');

    spy.mockClear(); // limpa qualquer chamada residual (não há nenhuma na emissão, mas por segurança)
    const buy = (await arrematar(investorToken, duplicataId)).lance;
    expect(buy.status).toBe(200);

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ duplicataId, evento: 'compra', registradoraKey }));
    spy.mockRestore();
  });
});
