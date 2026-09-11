import { logger } from './logger.js';

// A situação real de uma NF-e junto à SEFAZ é o segundo pilar do lastro de uma duplicata
// (o primeiro é o CNPJ do sacado — lib/cnpjLookup.ts): de nada adianta o sacado existir se
// a nota que sustenta o crédito foi cancelada ou denegada depois de anexada ao formulário.
//
// A SEFAZ não expõe essa consulta como API REST pública — o webservice oficial
// (nfeConsultaProtocolo) é SOAP, autenticado por certificado digital A1/A3 por UF, e é
// exatamente essa complexidade que a imensa maioria das integrações do mercado terceiriza
// pra um provedor de middleware NFe (Focus NFe, NFe.io, eNotas e afins), que mantém
// certificado/SOAP por trás de uma API REST simples com chave. Este adapter assume esse
// formato — mesmo raciocínio de lib/registradoras.ts (contrato privado, forma REST
// genérica real como ponto de partida) — em vez de reimplementar SOAP+mTLS aqui sem ter
// como validar contra a SEFAZ de verdade. NFE_STATUS_API_URL/KEY ficam vazios até você
// contratar um desses provedores (ou integrar direto via certificado, se preferir); sem
// eles, cai no mesmo padrão real-when-configured do resto desta base.
const apiUrl = process.env.NFE_STATUS_API_URL;
const apiKey = process.env.NFE_STATUS_API_KEY;
export const nfeStatusEnabled = !!(apiUrl && apiKey);

if (nfeStatusEnabled) logger.info('[nfe-status] provedor de status de NF-e configurado — situação real será consultada por chave de acesso');
else logger.info('[nfe-status] NFE_STATUS_API_URL/KEY não configurado — situação da NF-e não será verificada (só o dígito verificador da chave é checado)');

/**
 * Dígito verificador oficial da chave de acesso da NF-e (44 dígitos: 43 de dados + 1 DV,
 * módulo 11 com pesos de 2 a 9 aplicados da direita pra esquerda) — real, determinístico,
 * sem rede. O formulário de emissão já exige 44 dígitos (NFE_CHAVE_RE em emitirCore.ts);
 * isto confere se esses 44 dígitos são uma chave matematicamente possível.
 */
export function chaveNfeChecksumValida(chave: string): boolean {
  const digits = chave.replace(/\D/g, '');
  if (digits.length !== 44) return false;
  const nums = digits.slice(0, 43).split('').map(Number);
  let peso = 2;
  let soma = 0;
  for (let i = nums.length - 1; i >= 0; i--) {
    soma += nums[i] * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  const dv = resto < 2 ? 0 : 11 - resto;
  return dv === Number(digits[43]);
}

export type SituacaoNfe = 'autorizada' | 'cancelada' | 'denegada' | 'inexistente';

export interface NfeStatusResult {
  situacao: SituacaoNfe;
  motivo: string;
}

/**
 * Consulta real (provedor de middleware NFe configurado via NFE_STATUS_API_URL/KEY).
 * `null` quando desativado ou quando a consulta falha — nunca lança, pra não travar a
 * emissão por causa de um provedor externo fora do ar (mesma postura de
 * lib/registradoras.ts's informarNegociacao).
 */
export async function consultarSituacaoNfe(chave: string): Promise<NfeStatusResult | null> {
  if (!nfeStatusEnabled) return null;
  const digits = chave.replace(/\D/g, '');
  if (digits.length !== 44) return null;
  try {
    const res = await fetch(`${apiUrl}/nfe/${digits}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (res.status === 404) return { situacao: 'inexistente', motivo: 'NF-e não encontrada na base do provedor' };
    if (!res.ok) throw new Error(`nfe_status_fetch_failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { situacao?: string; motivo?: string };
    const situacao = (data.situacao || '').toLowerCase();
    const normalizada: SituacaoNfe =
      situacao === 'autorizada' || situacao === 'cancelada' || situacao === 'denegada' || situacao === 'inexistente' ? situacao : 'inexistente';
    return { situacao: normalizada, motivo: data.motivo || '' };
  } catch (err) {
    logger.warn({ err, chave: digits }, '[nfe-status] falha ao consultar situação da NF-e — seguindo sem essa verificação');
    return null;
  }
}
