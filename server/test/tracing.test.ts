import { describe, expect, it, vi, afterEach } from 'vitest';
import { getTracer, withSpan, tracingEnabled, startTracing } from '../src/lib/tracing.js';

describe('Tracing — real API, no-op unless configured', () => {
  const originalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  afterEach(() => {
    if (originalEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalEndpoint;
  });

  it('reports disabled and starts no SDK when OTEL_EXPORTER_OTLP_ENDPOINT is unset', async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    await startTracing();
    expect(tracingEnabled()).toBe(false);
  });

  it('getTracer() always returns a usable tracer, configured or not', () => {
    const tracer = getTracer();
    expect(tracer).toBeTruthy();
    expect(typeof tracer.startActiveSpan).toBe('function');
  });

  it('withSpan returns the wrapped function result', async () => {
    const result = await withSpan('test.op', { foo: 'bar' }, async () => 42);
    expect(result).toBe(42);
  });

  it('withSpan rethrows the original error after recording it, unmodified', async () => {
    const boom = new Error('kaboom');
    await expect(withSpan('test.op.fails', {}, async () => { throw boom; })).rejects.toBe(boom);
  });

  it('withSpan executes the wrapped function exactly once', async () => {
    const fn = vi.fn(async () => 'ok');
    await withSpan('test.op.once', {}, fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
