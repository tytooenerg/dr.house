import { isLowTaxJurisdiction } from '../data/lowTaxJurisdictions.js';
import { screenEntity } from '../db/sanctions.js';
import { recordForeignInvestorScreening, type ForeignInvestorScreeningRow } from '../db/foreignInvestorScreenings.js';
import { recordAuditEvent } from '../db/audit.js';
import type { UserRow } from '../db/types.js';

// Real regulatory groundwork for opening the marketplace to non-resident (INR) banks and
// investors — see the "quero também fazer oferta destas duplicatas a bancos e
// investidores internacionais" advisory answer this implements. What's real here: the
// jurisdiction check (IN RFB 1.037/2010), the enhanced PLD screening required by Res. CVM
// 50/2021 art. 8 for INR clients, and a deterministic eligibility memo an admin reviews
// during KYB approval. What this deliberately does NOT do — and cannot honestly do in
// software — is actually offer FIDC cotas to a foreign investor: that requires a
// CVM-authorized fund administrator, a CVM-registered securities distributor, and a
// BCB-authorized FX institution, none of which Lastro is. The memo says so explicitly,
// every time, regardless of what an LLM might otherwise be prompted to write — same
// "deterministic core" principle as LEGAL_DRAFT_DISCLAIMER in lib/legalCollection.ts.

export const FOREIGN_INVESTOR_DISCLAIMER =
  'Este memorando é uma triagem de elegibilidade preliminar, não uma oferta de valores mobiliários nem uma confirmação de que a operação está autorizada. ' +
  'A Lastro atua apenas como originadora e provedora de tecnologia nesta cadeia — não é administradora de fundo autorizada pela CVM, não é distribuidora de ' +
  'valores mobiliários registrada na CVM e não é instituição autorizada a operar câmbio pelo Banco Central. Uma oferta formal de cotas de FIDC a investidor ' +
  'não residente exige, necessariamente: (i) um administrador de fundo autorizado pela CVM (Res. CVM 21/2021); (ii) um distribuidor de valores mobiliários ' +
  'registrado na CVM, sob o rito da Res. CVM 160/2022; e (iii) uma instituição autorizada a operar no mercado de câmbio (Lei 14.286/2021, Res. BCB 277/2022) ' +
  'para a perna cambial. Este memorando não substitui parecer jurídico e deve ser revisado por advogado antes de qualquer contato comercial formal com o ' +
  'investidor.';

export type ClassificacaoInvestidor = 'profissional' | 'qualificado' | 'nao_classificado';

// Foreign institutional types are treated as profissional per Res. CVM 160/2022 art. 12 —
// banks, funds, fintechs de crédito and family offices are all institutional categories
// that qualify without a separate written declaration. Anything else needs an admin to
// classify manually (e.g. based on a declared financial-investment threshold), so this
// never silently promotes an unclear case to "profissional".
const INSTITUTIONAL_TIPOS = new Set(['Banco comercial', 'Fundo (FIDC)', 'Fintech de crédito', 'Family office']);

function classify(tipo: string | undefined): ClassificacaoInvestidor {
  if (tipo && INSTITUTIONAL_TIPOS.has(tipo)) return 'profissional';
  return 'nao_classificado';
}

function buildMemo(opts: {
  companyName: string;
  paisDomicilio: string;
  jurisdicaoFavorecida: boolean;
  classificacao: ClassificacaoInvestidor;
  representanteLegal: string;
  pldStatus: 'clear' | 'flagged';
  pldDetail: string;
}): string {
  const classificacaoLabel = opts.classificacao === 'profissional' ? 'Investidor Profissional (Res. CVM 160/2022)' : 'Não classificado — requer análise manual do admin';
  const jurisdicaoLabel = opts.jurisdicaoFavorecida
    ? 'SIM — consta na lista de jurisdições de tributação favorecida (IN RFB 1.037/2010). A isenção de IRRF da Lei 11.312/2006 NÃO se aplica; tributação padrão (15–22,5%, ou 25% se em regime fiscal privilegiado).'
    : 'Não consta na lista de jurisdições de tributação favorecida (IN RFB 1.037/2010) — elegível, em tese, à alíquota zero de IRRF da Lei 11.312/2006 (estendida pela MP 1.137/2022), sujeito a confirmação jurídica.';
  const pldLabel = opts.pldStatus === 'clear' ? 'Sem correspondência nas listas de sanções triadas (OFAC, ONU/CSNU).' : `Possível correspondência encontrada: ${opts.pldDetail}`;

  return [
    `MEMORANDO DE ELEGIBILIDADE — INVESTIDOR NÃO RESIDENTE`,
    ``,
    `Instituição: ${opts.companyName}`,
    `País de domicílio: ${opts.paisDomicilio || 'não informado'}`,
    `Representante legal no Brasil (Res. Conjunta BCB/CVM 13/2024, art. 6): ${opts.representanteLegal || 'não informado'}`,
    ``,
    `Classificação de investidor: ${classificacaoLabel}`,
    `Jurisdição de tributação favorecida: ${jurisdicaoLabel}`,
    `Triagem PLD reforçada (Res. CVM 50/2021 art. 8, GAFI/jurisdição de risco): ${pldLabel}`,
    ``,
    FOREIGN_INVESTOR_DISCLAIMER,
  ].join('\n');
}

export interface ForeignInvestorEligibility {
  paisDomicilio: string;
  jurisdicaoFavorecida: boolean;
  classificacao: ClassificacaoInvestidor;
  representanteLegal: string;
  pldStatus: 'clear' | 'flagged';
  pldDetail: string;
  memo: string;
}

// On-demand — never run automatically at KYB submission time, since (unlike the domestic
// PLD screening in lib/pldScreening.ts) this is a heavier, admin-triggered compliance
// step specific to the INR onboarding decision.
export async function checkForeignInvestorEligibility(user: UserRow): Promise<ForeignInvestorEligibility> {
  const kybForm = JSON.parse(user.kyb_form || '{}') as Record<string, string>;
  const paisDomicilio = kybForm.paisDomicilio || '';
  const representanteLegal = kybForm.representanteLegal || '';
  const jurisdicaoFavorecida = isLowTaxJurisdiction(paisDomicilio);
  const classificacao = classify(kybForm.tipo);

  const match = await screenEntity(user.company_name, kybForm.taxIdEstrangeiro || '', user.id);
  const pldStatus: 'clear' | 'flagged' = match ? 'flagged' : 'clear';
  const pldDetail = match ? `${match.nome} (${match.fonte === 'un_sc' ? 'Lista Consolidada do CSNU' : match.fonte})` : '';

  const memo = buildMemo({ companyName: user.company_name, paisDomicilio, jurisdicaoFavorecida, classificacao, representanteLegal, pldStatus, pldDetail });
  return { paisDomicilio, jurisdicaoFavorecida, classificacao, representanteLegal, pldStatus, pldDetail, memo };
}

export async function generateAndRecordEligibility(user: UserRow, adminId: number): Promise<ForeignInvestorScreeningRow> {
  const result = await checkForeignInvestorEligibility(user);
  const row = recordForeignInvestorScreening({
    userId: user.id,
    paisDomicilio: result.paisDomicilio,
    jurisdicaoFavorecida: result.jurisdicaoFavorecida,
    classificacaoInvestidor: result.classificacao,
    representanteLegal: result.representanteLegal,
    pldStatus: result.pldStatus,
    pldDetail: result.pldDetail,
    memo: result.memo,
    generatedBy: adminId,
  });
  recordAuditEvent(adminId, 'admin', 'kyb.memorando_investidor_estrangeiro_gerado', { userId: user.id, pldStatus: result.pldStatus });
  return row;
}

// Whether the KYB form marks this account as a non-resident investor at all — gates the
// extra UI/routes so a normal domestic investor never sees this flow.
export function isForeignInvestor(user: UserRow): boolean {
  try {
    const form = JSON.parse(user.kyb_form || '{}') as Record<string, unknown>;
    return !!form.naoResidente;
  } catch {
    return false;
  }
}
