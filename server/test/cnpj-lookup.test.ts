import { describe, expect, it } from 'vitest';
import { cnpjChecksumValido, consultarCnpj } from '../src/lib/cnpjLookup.js';

// O formulário de Emitir Duplicata sempre aceitou qualquer string não-vazia como CNPJ do
// sacado — "Dados do sacado e CNPJ" no checklist de lastro (lib/emitirCore.ts) só confere
// se o campo foi preenchido, nunca se o CNPJ é real. cnpjChecksumValido é o dígito
// verificador oficial da Receita Federal (mod 11): matemática pura, sem rede, que pega o
// erro de digitação/CNPJ inventado mais grosseiro. Boa parte dos CNPJs usados em fixtures
// deste próprio repositório (ex.: '44.333.222/0001-11', usado em vários testes de leilão)
// são sequências inventadas para teste — e por isso mesmo não passam neste dígito,
// confirmando que a checagem antiga não pegava nada de verdade.
describe('cnpjChecksumValido — dígito verificador oficial da Receita Federal', () => {
  it('aceita CNPJs reais (dígito verificador calculado corretamente)', () => {
    expect(cnpjChecksumValido('11.444.777/0001-61')).toBe(true);
    expect(cnpjChecksumValido('12.345.678/0001-95')).toBe(true);
    expect(cnpjChecksumValido('98.765.432/0001-98')).toBe(true);
    // Formato sem pontuação também é aceito — o dígito verificador não depende de máscara.
    expect(cnpjChecksumValido('11444777000161')).toBe(true);
  });

  it('rejeita os CNPJs de fixture já usados em outros testes deste repositório', () => {
    // Estes valores existem em testes de leilão/emissão espalhados pela suíte — nenhum
    // deles é um CNPJ real, o que é exatamente o ponto: a checagem antiga (só "não vazio")
    // nunca soube disso.
    expect(cnpjChecksumValido('44.333.222/0001-11')).toBe(false);
    expect(cnpjChecksumValido('12.345.678/0001-90')).toBe(false);
    expect(cnpjChecksumValido('34.567.890/0001-22')).toBe(false);
  });

  it('rejeita os 14 dígitos iguais — clássico "CNPJ" inválido que uma checagem só de tamanho deixaria passar', () => {
    expect(cnpjChecksumValido('00.000.000/0000-00')).toBe(false);
    expect(cnpjChecksumValido('11111111111111')).toBe(false);
  });

  it('rejeita tamanho errado', () => {
    expect(cnpjChecksumValido('123')).toBe(false);
    expect(cnpjChecksumValido('')).toBe(false);
  });
});

describe('consultarCnpj — consulta real à Receita Federal (BrasilAPI), atrás de CNPJ_LOOKUP_LIVE', () => {
  it('retorna null sem tentar rede nenhuma quando CNPJ_LOOKUP_LIVE não está ativo (padrão em dev/CI)', async () => {
    expect(process.env.CNPJ_LOOKUP_LIVE).not.toBe('true');
    const result = await consultarCnpj('11.444.777/0001-61');
    expect(result).toBeNull();
  });
});
