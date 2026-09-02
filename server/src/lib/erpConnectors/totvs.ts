import { logger } from '../logger.js';

// Real TOTVS REST API pattern — OAuth2 client_credentials against TOTVS's API gateway,
// same shape TOTVS's own developer portal documents for its modern REST surface. Like
// SAP, every TOTVS customer runs their own tenant/instance, so the cedente supplies their
// own base URL + client credentials from Integrações ERP — no Lastro-side commercial
// contract needed, same self-serve model Omie/SAP already use. Different TOTVS product
// lines (Protheus, RM, Fluig) expose slightly different REST resources under this same
// OAuth2 gateway; the contas-a-receber path below is meant to be adjusted to whichever
// product's actual API docs you're integrating against.

interface TotvsToken {
  accessToken: string;
}

async function totvsAuth(baseUrl: string, clientId: string, clientSecret: string): Promise<TotvsToken> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/authorization/v1/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`totvs_auth_failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string };
  if (!data.access_token) throw new Error('totvs_auth_no_token');
  return { accessToken: data.access_token };
}

export async function testTotvsConnection(baseUrl: string, clientId: string, clientSecret: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await totvsAuth(baseUrl, clientId, clientSecret);
    return { ok: true };
  } catch (err) {
    logger.warn({ err }, '[erp:totvs] falha ao validar credenciais');
    return { ok: false, error: err instanceof Error ? err.message : 'totvs_connection_failed' };
  }
}

export interface ContaReceberTotvs {
  id: string;
  cliente: string;
  numeroDocumento: string;
  valor: number;
  vencimento: string;
}

export interface ContaPagarTotvs {
  id: string;
  fornecedor: string;
  numeroDocumento: string;
  valor: number;
  vencimento: string;
}

export async function listarContasReceberTotvs(baseUrl: string, clientId: string, clientSecret: string): Promise<{ ok: boolean; contas: ContaReceberTotvs[]; error?: string }> {
  try {
    const token = await totvsAuth(baseUrl, clientId, clientSecret);
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/financas/v1/contas-a-receber?status=aberto&top=50`, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });
    if (!res.ok) throw new Error(`totvs_contas_failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { items?: { id: string; cliente: string; numeroDocumento?: string; valor: number; dataVencimento: string }[] };
    return {
      ok: true,
      contas: (data.items ?? []).map((r) => ({
        id: r.id,
        cliente: r.cliente,
        numeroDocumento: r.numeroDocumento || r.id,
        valor: r.valor,
        vencimento: r.dataVencimento,
      })),
    };
  } catch (err) {
    logger.warn({ err }, '[erp:totvs] falha ao listar contas a receber');
    return { ok: false, contas: [], error: err instanceof Error ? err.message : 'totvs_fetch_failed' };
  }
}

// Mirror of listarContasReceberTotvs against the AP counterpart resource — same honesty as
// the AR call above: this REST shape is meant to be adjusted to whichever TOTVS product
// line's (Protheus/RM/Fluig) actual contas-a-pagar API docs you're integrating against.
export async function listarContasPagarTotvs(baseUrl: string, clientId: string, clientSecret: string): Promise<{ ok: boolean; contas: ContaPagarTotvs[]; error?: string }> {
  try {
    const token = await totvsAuth(baseUrl, clientId, clientSecret);
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/financas/v1/contas-a-pagar?status=aberto&top=50`, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });
    if (!res.ok) throw new Error(`totvs_contas_pagar_failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { items?: { id: string; fornecedor: string; numeroDocumento?: string; valor: number; dataVencimento: string }[] };
    return {
      ok: true,
      contas: (data.items ?? []).map((r) => ({
        id: r.id,
        fornecedor: r.fornecedor,
        numeroDocumento: r.numeroDocumento || r.id,
        valor: r.valor,
        vencimento: r.dataVencimento,
      })),
    };
  } catch (err) {
    logger.warn({ err }, '[erp:totvs] falha ao listar contas a pagar');
    return { ok: false, contas: [], error: err instanceof Error ? err.message : 'totvs_fetch_failed' };
  }
}
