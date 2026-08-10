import { describe, expect, it, beforeAll } from 'vitest';
import { seedIfEmpty } from '../src/db/seed.js';
import { runPldAgentScan } from '../src/lib/pldAgentJob.js';

beforeAll(async () => {
  await seedIfEmpty();
});

describe('PLD agent background job', () => {
  it('is an honest no-op without ANTHROPIC_API_KEY — never fakes a scan', async () => {
    const result = await runPldAgentScan();
    expect(result).toEqual({ scanned: 0, newPendingActions: 0 });
  });
});
