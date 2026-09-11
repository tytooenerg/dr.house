import { logger } from './logger.js';

// O CNPJ do sacado é o dado mais básico do lastro de uma duplicata: sem ele bater com uma
// empresa que existe de verdade, não há ninguém pra cobrar no vencimento — exatamente o
// que um banco/FIDC confere antes de financiar um recebível. Duas camadas, no mesmo
// espírito real-when-configured do resto desta base:
//
// 1. Dígito verificador oficial da Receita Federal (mod 11) — matemática pura, sempre
//    ativa, sem rede nenhuma. Pega CNPJ inventado ou digitado errado sem depender de nada
//    externo — hoje o formulário de emissão só confere que o campo não está vazio.
//
// 2. Consulta real à Receita Federal via BrasilAPI — agregador que republica dado
//    público oficial (situação cadastral, razão social), sem credencial nenhuma exigida.
//    Diferente de lib/registradoras.ts/lib/creditBureau.ts, que dependem de um contrato
//    comercial pago, aqui o dado é gratuito e público — como a lista OFAC de
//    lib/sanctionsFeed.ts. CNPJ_LOOKUP_LIVE existe só pra manter dev/CI rápidos e
//    independentes de rede, não por custo ou por falta de acesso.
const liveEnabled = process.env.CNPJ_LOOKUP_LIVE === 'true';
const API_URL = process.env.CNPJ_LOOKUP_API_URL || 'https://brasilapi.com.br/api/cnpj/v1';

if (liveEnabled) logger.info('[cnpj] CNPJ_LOOKUP_LIVE ativo — situação cadastral real será consultada na Receita Federal (via BrasilAPI)');
else logger.info('[cnpj] CNPJ_LOOKUP_LIVE desativado — só o dígito verificador é checado, sem consulta externa');

const WEIGHTS_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const WEIGHTS_2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

function checkDigit(digits: number[], weights: number[]): number {
  const sum = digits.reduce((acc, d, i) => acc + d * weights[i], 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/**
 * Dígito verificador oficial da Receita Federal (mod 11) — real, determinístico, sem
 * rede. Recusa também os clássicos "CNPJ" de 14 dígitos iguais (00000000000000 etc.), que
 * passariam despercebidos por uma checagem só de formato/tamanho.
 */
export function cnpjChecksumValido(cnpj: string): boolean {
  const digits = cnpj.replace(/\D/g, '');
  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) return false;
  const nums = digits.split('').map(Number);
  const d1 = checkDigit(nums.slice(0, 12), WEIGHTS_1);
  if (d1 !== nums[12]) return false;
  const d2 = checkDigit(nums.slice(0, 13), WEIGHTS_2);
  return d2 === nums[13];
}

export interface CnpjInfo {
  razaoSocial: string;
  situacao: string;
  ativo: boolean;
}

/**
 * Consulta real (BrasilAPI → dado oficial da Receita Federal), atrás de CNPJ_LOOKUP_LIVE.
 * `null` quando desativado, quando o CNPJ não é encontrado, ou quando a consulta falha —
 * nunca lança pra não travar a emissão por causa de um provedor de dados público fora do
 * ar; a falha só fica registrada no log (mesma postura de lib/registradoras.ts's
 * informarNegociacao).
 */
export async function consultarCnpj(cnpj: string): Promise<CnpjInfo | null> {
  if (!liveEnabled) return null;
  const digits = cnpj.replace(/\D/g, '');
  if (digits.length !== 14) return null;
  try {
    const res = await fetch(`${API_URL}/${digits}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`cnpj_lookup_failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { razao_social?: string; descricao_situacao_cadastral?: string };
    const situacao = (data.descricao_situacao_cadastral || 'DESCONHECIDA').toUpperCase();
    return { razaoSocial: data.razao_social || '', situacao, ativo: situacao === 'ATIVA' };
  } catch (err) {
    logger.warn({ err, cnpj: digits }, '[cnpj] falha ao consultar CNPJ na Receita Federal — seguindo sem essa verificação');
    return null;
  }
}
