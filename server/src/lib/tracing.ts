import { trace, type Tracer, SpanStatusCode } from '@opentelemetry/api';
import { logger } from './logger.js';

// Real distributed tracing, real-when-configured — same discipline as every other
// integration in this codebase (Pix, registradoras, Claude, …). Without
// OTEL_EXPORTER_OTLP_ENDPOINT, no SDK is ever started: @opentelemetry/api's own
// default TracerProvider is a documented no-op, so getTracer()/withSpan() below are
// always safe to call from business logic — they cost nothing and emit nothing when
// unconfigured, and become real, exported spans the moment a real OTLP collector is
// configured, no code change required at any call site.
let started = false;

export async function startTracing(): Promise<void> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    logger.info('[tracing] OTEL_EXPORTER_OTLP_ENDPOINT não configurado — tracing distribuído desativado (spans são no-op)');
    return;
  }
  // Dynamic imports: the OTel Node SDK does real, non-trivial module-loading work at
  // import time (patching http/express for auto-instrumentation) — deferring that to
  // only-when-configured keeps an unconfigured server's startup identical to before this
  // feature existed, and keeps every downstream call site free of any conditional import.
  const [{ NodeSDK }, { getNodeAutoInstrumentations }, { OTLPTraceExporter }, { resourceFromAttributes }, { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION }] =
    await Promise.all([
      import('@opentelemetry/sdk-node'),
      import('@opentelemetry/auto-instrumentations-node'),
      import('@opentelemetry/exporter-trace-otlp-http'),
      import('@opentelemetry/resources'),
      import('@opentelemetry/semantic-conventions'),
    ]);

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'lastro-api',
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? '0.0.0',
    }),
    traceExporter: new OTLPTraceExporter({ url: endpoint }),
    instrumentations: [getNodeAutoInstrumentations()],
  });
  sdk.start();
  started = true;
  logger.info({ endpoint }, '[tracing] OpenTelemetry iniciado — exportando spans reais via OTLP');

  process.on('SIGTERM', () => {
    void sdk.shutdown();
  });
}

export const tracingEnabled = () => started;

export function getTracer(): Tracer {
  return trace.getTracer('lastro-api');
}

// Ergonomic wrapper for the manual spans this codebase adds at real I/O and business-logic
// boundaries (registradora calls, agent runs, …) beyond whatever auto-instrumentation
// catches — records a real exception and sets ERROR status on failure, always ends the
// span, and returns/rethrows exactly what fn() would have without this wrapper.
export async function withSpan<T>(name: string, attributes: Record<string, string | number | boolean>, fn: () => Promise<T>): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      span.end();
    }
  });
}
