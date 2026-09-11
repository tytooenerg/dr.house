import { describe, expect, it } from 'vitest';
import { chaveNfeChecksumValida, consultarSituacaoNfe } from '../src/lib/nfeStatus.js';

// Emitir Duplicata sempre exigiu 44 dígitos pra chave de acesso da NF-e (NFE_CHAVE_RE em
// lib/emitirCore.ts), mas nunca conferiu se esses 44 dígitos formam uma chave
// matematicamente possível. chaveNfeChecksumValida é o dígito verificador oficial (módulo
// 11, pesos de 2 a 9 da direita pra esquerda) — real, determinístico, sem rede.
describe('chaveNfeChecksumValida — dígito verificador oficial da chave de acesso da NF-e', () => {
  it('aceita chaves com dígito verificador calculado corretamente', () => {
    expect(chaveNfeChecksumValida('35260109330001445500100000000461900000000464')).toBe(true);
    expect(chaveNfeChecksumValida('12345678901234567890123456789012345678901235')).toBe(true);
  });

  it('rejeita a chave usada em compliance-hardening.test.ts (44 dígitos iguais, nunca teve dígito verificador conferido)', () => {
    expect(chaveNfeChecksumValida('1'.repeat(44))).toBe(false);
  });

  it('rejeita quando o último dígito é alterado (dígito verificador não bate mais)', () => {
    const valida = '35260109330001445500100000000461900000000464';
    const alterada = valida.slice(0, 43) + (valida.at(-1) === '0' ? '1' : '0');
    expect(chaveNfeChecksumValida(alterada)).toBe(false);
  });

  it('rejeita tamanho errado', () => {
    expect(chaveNfeChecksumValida('12345')).toBe(false);
    expect(chaveNfeChecksumValida('')).toBe(false);
  });
});

describe('consultarSituacaoNfe — status real (provedor de middleware NFe), atrás de NFE_STATUS_API_URL/KEY', () => {
  it('retorna null sem tentar rede nenhuma quando não está configurado (padrão em dev/CI)', async () => {
    expect(process.env.NFE_STATUS_API_URL).toBeFalsy();
    const result = await consultarSituacaoNfe('35260109330001445500100000000461900000000464');
    expect(result).toBeNull();
  });
});
