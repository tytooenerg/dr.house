import { LastroApiError, LastroNetworkError } from './errors.js';
import type {
  AceiteStatus,
  AceiteView,
  CashflowForecast,
  DecidirSinistroInput,
  DuplicataListItem,
  DuplicataView,
  EmitirDuplicataInput,
  EmitirDuplicataResult,
  MarketplaceOffer,
  PayableView,
  PldTriagemInput,
  PldTriagemResult,
  ReportSignalInput,
  ScoreView,
  SeguradoraPayload,
} from './types.js';

export interface LastroClientOptions {
  /** A real API key from Desenvolvedores — `lastro_live_…` or `lastro_test_…` (sandbox). */
  apiKey: string;
  /** Defaults to the production API. Override for local dev, e.g. http://localhost:4000/api/v1. */
  baseUrl?: string;
  /** Injectable for testing / non-standard runtimes — defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Request timeout in ms. Defaults to 15s, matching the server's own outbound timeouts. */
  timeoutMs?: number;
}

export interface RequestOptions {
  /**
   * Makes a mutating request safe to retry: resending the same Idempotency-Key with the
   * same body replays the original response instead of repeating the side effect (see
   * lib/idempotency.ts). Only meaningful on POST /duplicatas, POST /aceites/:id/status and
   * POST /seguradora/sinistro/:id/decidir — passed through unused elsewhere.
   */
  idempotencyKey?: string;
}

// Zero runtime dependencies — this SDK is a thin, typed wrapper over the real HTTP API
// (server/src/routes/v1.ts), using the platform's built-in fetch (Node 18+, browsers,
// Deno, Bun, Cloudflare Workers). No code generation, no magic: one method per real
// endpoint, matching the OpenAPI spec served at GET /api/v1/openapi.json.
export class LastroClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: LastroClientOptions) {
    if (!options.apiKey || !options.apiKey.trim()) {
      throw new Error('LastroClient requires a real apiKey (from Desenvolvedores in the Lastro app).');
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? 'https://api.lastro.com.br/v1').replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  private async request<T>(method: string, path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts?.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      throw new LastroNetworkError(`Failed to reach the Lastro API at ${this.baseUrl}${path}`, err);
    } finally {
      clearTimeout(timeout);
    }

    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) throw new LastroApiError(res.status, data);
    return data as T;
  }

  // --- Duplicatas (cedente accounts) ---

  /** Emit a real duplicata escriturada. Requires a write-scope key on a cedente account. */
  emitirDuplicata(input: EmitirDuplicataInput, opts?: RequestOptions): Promise<EmitirDuplicataResult> {
    return this.request('POST', '/duplicatas', input, opts);
  }

  getDuplicata(id: string): Promise<DuplicataView> {
    return this.request('GET', `/duplicatas/${encodeURIComponent(id)}`);
  }

  /** Todas as duplicatas do cedente dono da chave — pensado pra cálculos de DSO/aging/concentração. */
  listDuplicatas(): Promise<{ duplicatas: DuplicataListItem[] }> {
    return this.request('GET', '/duplicatas');
  }

  // --- Marketplace ---

  listMarketplace(): Promise<{ offers: MarketplaceOffer[] }> {
    return this.request('GET', '/marketplace');
  }

  // --- Financeiro (cedente accounts) ---

  /** Contas a pagar do cedente dono da chave — mesma listagem de /app/contas-pagar na SPA. */
  listPayables(): Promise<{ payables: PayableView[] }> {
    return this.request('GET', '/payables');
  }

  /** Projeção de fluxo de caixa (cenários + insights) — mesma projeção da aba AI CFO na SPA. */
  getCashflowForecast(): Promise<CashflowForecast> {
    return this.request('GET', '/cashflow/forecast');
  }

  // --- Aceites (sacado accounts) ---

  listAceites(): Promise<{ aceites: AceiteView[] }> {
    return this.request('GET', '/aceites');
  }

  /** Confirm or contest an aceite. Requires a write-scope key. */
  decideAceite(id: number, status: AceiteStatus, opts?: RequestOptions): Promise<unknown> {
    return this.request('POST', `/aceites/${id}/status`, { status }, opts);
  }

  // --- Seguradora (insurer accounts) ---

  getSeguradoraPayload(): Promise<SeguradoraPayload> {
    return this.request('GET', '/seguradora');
  }

  /** Approve or deny a sinistro claim. Requires a write-scope key on a seguradora account. */
  decidirSinistro(duplicataId: string, input: DecidirSinistroInput, opts?: RequestOptions): Promise<unknown> {
    return this.request('POST', `/seguradora/sinistro/${encodeURIComponent(duplicataId)}/decidir`, input, opts);
  }

  // --- Score / rede de sinais ---

  /** Real-time blended credit score for a CNPJ — internal history + cross-partner signals. */
  getScore(cnpj: string): Promise<ScoreView> {
    return this.request('GET', `/sacados/${encodeURIComponent(cnpj)}/score`);
  }

  /** Report a payment-behavior observation for a CNPJ into the shared risk-signal network. */
  reportSignal(cnpj: string, input: ReportSignalInput): Promise<ScoreView> {
    return this.request('POST', `/sacados/${encodeURIComponent(cnpj)}/sinais`, input);
  }

  // --- PLD/AML screening ---

  /** Screen a name/document against the real OFAC SDN + UN sanctions lists. */
  screenPld(input: PldTriagemInput): Promise<PldTriagemResult> {
    return this.request('POST', '/pld/triagem', input);
  }
}
