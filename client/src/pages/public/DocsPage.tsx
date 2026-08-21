import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PublicNav, PublicFooter } from './PublicChrome';

// A real, unauthenticated developer documentation page — distinct from DevelopersPage.tsx
// (marketing landing, sells the API) and from the in-app DevPage.tsx (an authenticated
// console for managing your own keys/webhooks/usage). Neither of those is something a
// prospective integrator can actually read *before* creating an account, which is the gap
// this closes: this page needs no login, is linked from the public nav, and renders the
// real live spec served at GET /api/v1/openapi.json (server/src/data/openapi.ts) — not a
// static copy that can drift from what the API actually accepts.
interface OpenApiParam {
  name: string;
  in: string;
  required?: boolean;
  schema?: { type?: string };
  description?: string;
}
interface OpenApiSchemaProperty {
  type?: string;
  example?: unknown;
  enum?: string[];
  default?: unknown;
}
interface OpenApiOperation {
  summary?: string;
  description?: string;
  parameters?: OpenApiParam[];
  requestBody?: {
    required?: boolean;
    content?: {
      'application/json'?: {
        schema?: {
          required?: string[];
          properties?: Record<string, OpenApiSchemaProperty>;
        };
      };
    };
  };
  responses?: Record<string, { description?: string }>;
}
interface OpenApiSpec {
  openapi: string;
  info: { title: string; version: string; description: string };
  paths: Record<string, Record<string, OpenApiOperation>>;
}

const RATE_LIMITS = [
  { tier: 'Chave sandbox (lastro_test_…)', limit: '60/min' },
  { tier: 'Plano Básico (chave live)', limit: '60/min' },
  { tier: 'Plano Pro', limit: '150/min' },
  { tier: 'Plano Empresarial', limit: '400/min' },
  { tier: 'Risk Score API / PLD Screening API (produto avulso)', limit: '200/min' },
];

const WEBHOOK_EVENTS = [
  'duplicata.registrada',
  'pagamento.confirmado',
  'sinistro.decidido',
  'rating.alterado',
  'block_trade.executado',
];

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-navy text-[#C7D6FF] rounded-lg p-4.5 text-[12.5px] leading-relaxed overflow-x-auto font-mono-num whitespace-pre">
      {children}
    </pre>
  );
}

const SAMPLES = {
  curl: `curl -X POST https://api.lastro.com.br/v1/duplicatas \\
  -H "Authorization: Bearer lastro_test_..." \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: minha-chave-unica-001" \\
  -d '{
    "sacado": "Grupo Atlas Varejo",
    "cnpj": "12.345.678/0001-90",
    "valor": "84.500,00",
    "vencimento": "2026-08-12",
    "seguro": true
  }'`,
  node: `import { LastroClient } from '@lastro/sdk';

const client = new LastroClient({ apiKey: 'lastro_test_...' });

const result = await client.emitirDuplicata(
  { sacado: 'Grupo Atlas Varejo', cnpj: '12.345.678/0001-90', valor: '84.500,00', vencimento: '2026-08-12', seguro: true },
  { idempotencyKey: 'minha-chave-unica-001' }
);
console.log(result.registro, result.mode); // "ESC-2026-000123", "test"`,
  python: `from lastro_sdk import LastroClient

client = LastroClient(api_key="lastro_test_...")

result = client.emitir_duplicata(
    {"sacado": "Grupo Atlas Varejo", "cnpj": "12.345.678/0001-90", "valor": "84.500,00", "vencimento": "2026-08-12", "seguro": True},
    idempotency_key="minha-chave-unica-001",
)
print(result["registro"], result["mode"])`,
};

function paramExample(props?: Record<string, OpenApiSchemaProperty>): string {
  if (!props) return '{}';
  const obj: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(props)) {
    obj[key] = prop.example ?? prop.default ?? (prop.enum ? prop.enum[0] : `<${prop.type ?? 'string'}>`);
  }
  return JSON.stringify(obj, null, 2);
}

export function DocsPage() {
  const [spec, setSpec] = useState<OpenApiSpec | null>(null);
  const [error, setError] = useState('');
  const [sample, setSample] = useState<'curl' | 'node' | 'python'>('curl');

  useEffect(() => {
    fetch('/api/v1/openapi.json')
      .then((r) => r.json())
      .then(setSpec)
      .catch(() => setError('Não foi possível carregar a especificação ao vivo agora — tente novamente em instantes.'));
  }, []);

  return (
    <div className="w-full text-navy overflow-x-hidden">
      <PublicNav active="docs" />

      <div className="px-14 py-16 max-w-[900px]">
        <div className="text-[13px] font-bold text-blue uppercase tracking-wide mb-2.5">Referência da API</div>
        <div className="text-[38px] font-extrabold tracking-tight leading-tight">Documentação da Lastro Partner API</div>
        <div className="text-base text-textSecondary mt-4 leading-relaxed">
          Esta página renderiza a especificação OpenAPI real, servida ao vivo em{' '}
          <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer" className="text-blue font-semibold">
            GET /api/v1/openapi.json
          </a>{' '}
          — não uma cópia estática que pode ficar desatualizada em relação ao que a API realmente aceita hoje. Nenhum login é necessário para ler esta
          página; você só precisa de uma chave para chamar os endpoints de verdade.
        </div>
      </div>

      <div className="px-14 pb-10 max-w-[900px]">
        <div className="font-bold text-lg mb-3">Começando</div>
        <div className="text-textSecondary text-[14px] leading-relaxed mb-4">
          Toda chamada usa a URL base <code className="font-mono-num bg-chip px-1.5 py-0.5 rounded">/api/v1</code> e autenticação por{' '}
          <code className="font-mono-num bg-chip px-1.5 py-0.5 rounded">Authorization: Bearer &lt;sua chave&gt;</code>. Gere uma chave gratuita em{' '}
          <Link to="/login" className="text-blue font-semibold">
            Desenvolvedores
          </Link>{' '}
          dentro do app — uma chave <code className="font-mono-num">lastro_test_…</code> (modo sandbox, sempre grátis, dados isolados de teste) ou{' '}
          <code className="font-mono-num">lastro_live_…</code> (modo produção, requer plano Empresarial).
        </div>
        <div className="flex gap-2 mb-3">
          {(['curl', 'node', 'python'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setSample(k)}
              className="px-3.5 py-1.5 rounded-md text-[12.5px] font-bold cursor-pointer"
              style={{ background: sample === k ? '#0B1F3A' : '#F0F2F5', color: sample === k ? '#fff' : '#5B6472' }}
            >
              {k === 'curl' ? 'cURL' : k === 'node' ? 'Node.js' : 'Python'}
            </button>
          ))}
        </div>
        <CodeBlock>{SAMPLES[sample]}</CodeBlock>
        <div className="text-textTertiary text-[12.5px] mt-3 leading-relaxed">
          Os SDKs oficiais (<code className="font-mono-num">@lastro/sdk</code> para Node/TypeScript, <code className="font-mono-num">lastro-sdk</code>{' '}
          para Python) são de código aberto no monorepo (<code className="font-mono-num">sdks/node</code>, <code className="font-mono-num">sdks/python</code>)
          e têm suíte de testes real rodando contra um servidor real — mas ainda não foram publicados no npm/PyPI (nenhuma conta de registry real
          configurada até este momento), então instale a partir do código-fonte enquanto isso.
        </div>
      </div>

      <div className="px-14 pb-10 max-w-[900px] grid gap-8" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div>
          <div className="font-bold text-lg mb-3">Limites de requisição</div>
          <div className="border border-border rounded-card overflow-hidden">
            {RATE_LIMITS.map((r) => (
              <div key={r.tier} className="flex items-center justify-between px-4 py-3 border-b border-hairline last:border-b-0 text-[13px]">
                <span className="text-textSecondary">{r.tier}</span>
                <span className="font-mono-num font-bold">{r.limit}</span>
              </div>
            ))}
          </div>
          <div className="text-textTertiary text-[12px] mt-2">Uma requisição além do limite retorna 429 com cabeçalhos padrão de rate limit.</div>
        </div>
        <div>
          <div className="font-bold text-lg mb-3">Webhooks</div>
          <div className="text-textSecondary text-[13.5px] leading-relaxed mb-3">
            Cada entrega é um POST assinado (HMAC-SHA256 sobre o corpo, cabeçalho <code className="font-mono-num">X-Lastro-Signature</code>), com retry
            (imediato / 30s / 5min / 30min) e log de entregas visível em Desenvolvedores.
          </div>
          <div className="flex flex-wrap gap-1.5">
            {WEBHOOK_EVENTS.map((e) => (
              <span key={e} className="font-mono-num text-[11.5px] bg-chip text-blue px-2 py-1 rounded-md">
                {e}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="px-14 pb-10 max-w-[900px]">
        <div className="font-bold text-lg mb-2">Estabilidade e versionamento</div>
        <div className="text-textSecondary text-[13.5px] leading-relaxed">
          <code className="font-mono-num bg-chip px-1.5 py-0.5 rounded">/v1</code> nunca foi descontinuada — nenhum parceiro jamais recebeu um aviso de
          migração. Se um dia isso mudar, uma futura <code className="font-mono-num">/v2</code> coexistirá com <code className="font-mono-num">/v1</code>{' '}
          por no mínimo 12 meses antes de qualquer desligamento, e toda resposta de <code className="font-mono-num">/v1</code> passará a carregar
          cabeçalhos reais <code className="font-mono-num">Deprecation</code>/<code className="font-mono-num">Sunset</code> (RFC 8594) — mecanismo já
          implementado e testado hoje, só inativo porque nada foi de fato descontinuado ainda. Política completa (o que conta como mudança quebradora,
          prazo de aviso, como uma v2 coexistiria) em <code className="font-mono-num">docs/api-versioning-policy.md</code> no repositório.
        </div>
      </div>

      <div className="px-14 pb-10 max-w-[900px]">
        <div className="font-bold text-lg mb-2">Idempotência</div>
        <div className="text-textSecondary text-[13.5px] leading-relaxed">
          Todo endpoint de mutação aceita um cabeçalho opcional <code className="font-mono-num bg-chip px-1.5 py-0.5 rounded">Idempotency-Key</code>.
          Reenviar a mesma chave com o mesmo corpo replica a resposta original em vez de repetir o efeito colateral (emitir de novo, decidir de novo);
          reenviar com um corpo diferente retorna <code className="font-mono-num">409</code>. Mesmo contrato que o Stripe usa.
        </div>
      </div>

      <div className="px-14 py-12 bg-[#F7F8FA] border-t border-b border-hairline">
        <div className="max-w-[900px]">
          <div className="font-bold text-xl mb-1">Endpoints</div>
          <div className="text-textSecondary text-[13.5px] mb-6">
            Gerado ao vivo a partir da especificação real — {spec ? `${Object.keys(spec.paths).length} rotas documentadas` : 'carregando…'}.
          </div>
          {error && <div className="text-red text-[13px] font-semibold">{error}</div>}
          {!spec && !error && <div className="text-textSecondary text-[13px]">Carregando especificação…</div>}
          <div className="flex flex-col gap-5">
            {spec &&
              Object.entries(spec.paths).map(([path, methods]) =>
                Object.entries(methods).map(([method, op]) => {
                  const props = op.requestBody?.content?.['application/json']?.schema?.properties;
                  const required = op.requestBody?.content?.['application/json']?.schema?.required ?? [];
                  return (
                    <div key={`${method}-${path}`} className="bg-white border border-border rounded-card p-5">
                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                        <span
                          className="font-mono-num font-extrabold text-[12.5px] px-2 py-0.5 rounded"
                          style={{ background: method === 'get' ? '#EEF3FF' : '#EAF3EE', color: method === 'get' ? '#1E5EFF' : '#0A5C36' }}
                        >
                          {method.toUpperCase()}
                        </span>
                        <span className="font-mono-num text-[14px] font-bold">/v1{path}</span>
                      </div>
                      <div className="font-semibold text-[14px] mb-1">{op.summary}</div>
                      {op.description && <div className="text-textSecondary text-[12.5px] leading-relaxed mb-3">{op.description}</div>}
                      {op.parameters && op.parameters.filter((p) => p.name !== undefined && p.in === 'path').length > 0 && (
                        <div className="mb-3">
                          <div className="text-[11px] font-bold text-textTertiary uppercase mb-1.5">Parâmetros de rota</div>
                          {op.parameters
                            .filter((p) => p.in === 'path')
                            .map((p) => (
                              <div key={p.name} className="text-[12.5px] font-mono-num text-textSecondary">
                                {p.name} <span className="text-textTertiary">({p.schema?.type ?? 'string'}, obrigatório)</span>
                              </div>
                            ))}
                        </div>
                      )}
                      {props && (
                        <div className="mb-3">
                          <div className="text-[11px] font-bold text-textTertiary uppercase mb-1.5">Corpo da requisição</div>
                          <CodeBlock>{paramExample(props)}</CodeBlock>
                          <div className="text-[11.5px] text-textTertiary mt-1">
                            Obrigatório(s): {required.length > 0 ? required.join(', ') : '—'}
                          </div>
                        </div>
                      )}
                      {op.responses && (
                        <div>
                          <div className="text-[11px] font-bold text-textTertiary uppercase mb-1.5">Respostas</div>
                          <div className="flex flex-col gap-1">
                            {Object.entries(op.responses).map(([status, r]) => (
                              <div key={status} className="text-[12.5px] flex gap-2">
                                <span className="font-mono-num font-bold" style={{ color: status.startsWith('2') ? '#0A5C36' : '#B8790A' }}>
                                  {status}
                                </span>
                                <span className="text-textSecondary">{r.description}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
          </div>
        </div>
      </div>

      <div className="px-14 py-16 text-center">
        <div className="text-[28px] font-extrabold tracking-tight">Pronto para gerar sua primeira chave?</div>
        <div className="flex gap-3 justify-center mt-6">
          <Link to="/login" className="px-6 py-3.5 rounded-lg bg-blue text-white font-bold text-[15px]">
            Criar conta de desenvolvedor
          </Link>
          <Link to="/developers" className="px-6 py-3.5 rounded-lg border border-inputBorder text-navy font-bold text-[15px]">
            Ver visão geral do produto
          </Link>
        </div>
      </div>

      <PublicFooter />
    </div>
  );
}
