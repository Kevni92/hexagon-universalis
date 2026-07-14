import { describe, expect, it } from 'vitest';

import { clamp } from '@/shared/clamp';

describe('clamp', () => {
  it('begrenzt Werte auf das konfigurierte Intervall', () => {
    expect(clamp(-2, 0, 10)).toBe(0);
    expect(clamp(4, 0, 10)).toBe(4);
    expect(clamp(14, 0, 10)).toBe(10);
  });

  it('lehnt ein ungültiges Intervall ab', () => {
    expect(() => clamp(1, 2, 1)).toThrow(RangeError);
  });
});
