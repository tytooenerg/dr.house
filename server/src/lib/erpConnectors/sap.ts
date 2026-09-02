import { logger } from '../logger.js';

// Real SAP Business One Service Layer API
// (https://help.sap.com/docs/SAP_BUSINESS_ONE_SERVICE_LAYER) — the standard OData REST
// surface SAP Business One exposes for exactly this kind of integration. Unlike Omie (a
// single global SaaS endpoint), every SAP customer runs their own instance, so the
// cedente supplies their own base URL + company DB + credentials from Integrações ERP —
// same self-serve, no-Lastro-side-contract-needed model Omie already uses. This targets
// SAP Business One specifically; a S/4HANA landscape would need this adjusted to its own
// OData services.

interface SapSession {
  sessionId: string;
}

async function sapLogin(baseUrl: string, companyDb: string, username: string, password: string): Promise<SapSession> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/b1s/v1/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ CompanyDB: companyDb, UserName: username, Password: password }),
  });
  if (!res.ok) throw new Error(`sap_login_failed: ${res.status} ${await res.text()}`);
  const setCookie = res.headers.get('set-cookie') || '';
  const match = /B1SESSION=([^;]+)/.exec(setCookie);
  const data = (await res.json().catch(() => ({}))) as { SessionId?: string };
  const sessionId = match?.[1] || data.SessionId;
  if (!sessionId) throw new Error('sap_login_no_session');
  return { sessionId };
}

export async function testSapConnection(baseUrl: string, companyDb: string, username: string, password: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await sapLogin(baseUrl, companyDb, username, password);
    return { ok: true };
  } catch (err) {
    logger.warn({ err }, '[erp:sap] falha ao validar credenciais');
    return { ok: false, error: err instanceof Error ? err.message : 'sap_connection_failed' };
  }
}

export interface ContaReceberSap {
  id: string;
  cliente: string;
  numeroDocumento: string;
  valor: number;
  vencimento: string;
}

export interface ContaPagarSap {
  id: string;
  fornecedor: string;
  numeroDocumento: string;
  valor: number;
  vencimento: string;
}

// Pulls open (bost_Open) sales invoices from the cedente's own SAP Business One tenant —
// same "turn ERP data into duplicata candidates" role listarContasReceberOmie plays.
export async function listarContasReceberSap(baseUrl: string, companyDb: string, username: string, password: string): Promise<{ ok: boolean; contas: ContaReceberSap[]; error?: string }> {
  try {
    const session = await sapLogin(baseUrl, companyDb, username, password);
    const res = await fetch(
      `${baseUrl.replace(/\/$/, '')}/b1s/v1/Invoices?$filter=DocumentStatus eq 'bost_Open'&$select=DocEntry,CardName,NumAtCard,DocTotal,DocDueDate&$top=50`,
      { headers: { Cookie: `B1SESSION=${session.sessionId}` } }
    );
    if (!res.ok) throw new Error(`sap_invoices_failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { value?: { DocEntry: number; CardName: string; NumAtCard?: string; DocTotal: number; DocDueDate: string }[] };
    return {
      ok: true,
      contas: (data.value ?? []).map((r) => ({
        id: String(r.DocEntry),
        cliente: r.CardName,
        numeroDocumento: r.NumAtCard || String(r.DocEntry),
        valor: r.DocTotal,
        vencimento: r.DocDueDate,
      })),
    };
  } catch (err) {
    logger.warn({ err }, '[erp:sap] falha ao listar faturas em aberto');
    return { ok: false, contas: [], error: err instanceof Error ? err.message : 'sap_fetch_failed' };
  }
}

// Mirror of listarContasReceberSap against PurchaseInvoices — the standard SAP Business One
// Service Layer entity for supplier invoices, same document family as Invoices (sales) just
// on the AP side: same DocumentStatus/DocTotal/DocDueDate fields, CardName here holds the
// vendor's name instead of the customer's.
export async function listarContasPagarSap(baseUrl: string, companyDb: string, username: string, password: string): Promise<{ ok: boolean; contas: ContaPagarSap[]; error?: string }> {
  try {
    const session = await sapLogin(baseUrl, companyDb, username, password);
    const res = await fetch(
      `${baseUrl.replace(/\/$/, '')}/b1s/v1/PurchaseInvoices?$filter=DocumentStatus eq 'bost_Open'&$select=DocEntry,CardName,NumAtCard,DocTotal,DocDueDate&$top=50`,
      { headers: { Cookie: `B1SESSION=${session.sessionId}` } }
    );
    if (!res.ok) throw new Error(`sap_purchase_invoices_failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { value?: { DocEntry: number; CardName: string; NumAtCard?: string; DocTotal: number; DocDueDate: string }[] };
    return {
      ok: true,
      contas: (data.value ?? []).map((r) => ({
        id: String(r.DocEntry),
        fornecedor: r.CardName,
        numeroDocumento: r.NumAtCard || String(r.DocEntry),
        valor: r.DocTotal,
        vencimento: r.DocDueDate,
      })),
    };
  } catch (err) {
    logger.warn({ err }, '[erp:sap] falha ao listar contas a pagar em aberto');
    return { ok: false, contas: [], error: err instanceof Error ? err.message : 'sap_fetch_failed' };
  }
}
