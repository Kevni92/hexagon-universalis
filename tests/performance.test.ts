import { describe, expect, it } from 'vitest';

import {
  PERFORMANCE_BUDGETS,
  ResourceLedger,
  validatePerformanceBudget,
} from '@/rendering/Performance';

describe('performance budgets', () => {
  it('defines fixed low/default profiles without debug requirements', () => {
    expect(PERFORMANCE_BUDGETS.default.frequency).toBe(2);
    expect(PERFORMANCE_BUDGETS.low.frequency).toBe(1);
    expect(PERFORMANCE_BUDGETS.default.maxDrawCalls).toBeLessThan(10);
  });

  it('detects persistent resource growth after layer changes', () => {
    const ledger = new ResourceLedger();
    ledger.allocate('geometries');
    ledger.allocate('materials');
    const baseline = ledger.snapshot();
    ledger.release('geometries');
    ledger.release('materials');
    ledger.assertNoGrowth(baseline);
    ledger.allocate('textures');
    expect(() => ledger.assertNoGrowth(baseline)).toThrow(/textures/);
  });

  it('rejects artifact and render budgets deterministically', () => {
    expect(() => validatePerformanceBudget(PERFORMANCE_BUDGETS.default, 1_000, 1, 1)).not.toThrow();
    expect(() => validatePerformanceBudget(PERFORMANCE_BUDGETS.default, 9_000_000, 1, 1)).toThrow();
    expect(() => validatePerformanceBudget(PERFORMANCE_BUDGETS.default, 1_000, 9, 1)).toThrow();
  });
});
