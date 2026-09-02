import { logger } from '../logger.js';

// Real Omie API client (https://developer.omie.com.br) — unlike the other adapters in
// this codebase, this doesn't need a platform-level commercial contract: Omie is a
// self-serve Brazilian ERP for SMEs, and any cedente who already has an Omie account can
// generate their own app_key/app_secret (Omie > Configurações > API) and plug them in
// directly from Integrações ERP. So this one is "real" for any user who provides their
// own real credentials, not gated by a Lastro-side env var like paymentRail/registradoras.
const BASE_URL = 'https://app.omie.com.br/api/v1';

interface OmieCallResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function omieCall<T>(module: string, resource: string, call: string, appKey: string, appSecret: string, param: Record<string, unknown>): Promise<OmieCallResult<T>> {
  const res = await fetch(`${BASE_URL}/${module}/${resource}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }),
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || (body && typeof body.faultstring === 'string')) {
    return { ok: false, error: (body?.faultstring as string) || `omie_http_${res.status}` };
  }
  return { ok: true, data: body as T };
}

export async function testOmieConnection(appKey: string, appSecret: string): Promise<{ ok: boolean; error?: string }> {
  const result = await omieCall('geral/empresas', 'empresas', 'ListarEmpresas', appKey, appSecret, { pagina: 1, registros_por_pagina: 1 });
  if (!result.ok) logger.warn({ error: result.error }, '[erp:omie] falha ao validar credenciais');
  return { ok: result.ok, error: result.error };
}

export interface ContaReceberOmie {
  codigoLancamento: number;
  cliente: string;
  numeroDocumento: string;
  valor: number;
  vencimento: string;
}

export interface ContaPagarOmie {
  codigoLancamento: number;
  fornecedor: string;
  numeroDocumento: string;
  valor: number;
  vencimento: string;
}

interface ListarContasReceberResponse {
  conta_receber_cadastro?: {
    codigo_lancamento_omie: number;
    codigo_cliente_fornecedor: number;
    numero_documento: string;
    valor_documento: number;
    data_vencimento: string;
    nome_cliente_fornecedor?: string;
  }[];
}

// Pulls open (not-yet-received) contas a receber from the cedente's own Omie account —
// exactly the data a real ERP integration should turn into duplicata candidates, instead
// of the manual-entry-only flow Emitir Duplicata otherwise requires.
export async function listarContasReceberOmie(appKey: string, appSecret: string): Promise<{ ok: boolean; contas: ContaReceberOmie[]; error?: string }> {
  const result = await omieCall<ListarContasReceberResponse>('financas/contareceber', 'contareceber', 'ListarContasReceber', appKey, appSecret, {
    pagina: 1,
    registros_por_pagina: 50,
    apenas_importado_api: 'N',
  });
  if (!result.ok || !result.data) return { ok: false, contas: [], error: result.error };
  const rows = result.data.conta_receber_cadastro ?? [];
  return {
    ok: true,
    contas: rows.map((r) => ({
      codigoLancamento: r.codigo_lancamento_omie,
      cliente: r.nome_cliente_fornecedor || `Cliente #${r.codigo_cliente_fornecedor}`,
      numeroDocumento: r.numero_documento,
      valor: r.valor_documento,
      vencimento: r.data_vencimento,
    })),
  };
}

interface ListarContasPagarResponse {
  conta_pagar_cadastro?: {
    codigo_lancamento_omie: number;
    codigo_cliente_fornecedor: number;
    numero_documento: string;
    valor_documento: number;
    data_vencimento: string;
    nome_cliente_fornecedor?: string;
  }[];
}

// Mirror of listarContasReceberOmie against Omie's contapagar module (same real,
// documented API, symmetric AR/AP shape — Omie's "Cliente/Fornecedor" is one shared cadastro
// entity, so the field names on the wire are identical to the AR call above). Feeds
// db/payables.ts's upsertErpPayables instead of a duplicata candidate.
export async function listarContasPagarOmie(appKey: string, appSecret: string): Promise<{ ok: boolean; contas: ContaPagarOmie[]; error?: string }> {
  const result = await omieCall<ListarContasPagarResponse>('financas/contapagar', 'contapagar', 'ListarContasPagar', appKey, appSecret, {
    pagina: 1,
    registros_por_pagina: 50,
    apenas_importado_api: 'N',
  });
  if (!result.ok || !result.data) return { ok: false, contas: [], error: result.error };
  const rows = result.data.conta_pagar_cadastro ?? [];
  return {
    ok: true,
    contas: rows.map((r) => ({
      codigoLancamento: r.codigo_lancamento_omie,
      fornecedor: r.nome_cliente_fornecedor || `Fornecedor #${r.codigo_cliente_fornecedor}`,
      numeroDocumento: r.numero_documento,
      valor: r.valor_documento,
      vencimento: r.data_vencimento,
    })),
  };
}
