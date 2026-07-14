import { describe, expect, it } from 'vitest';

import {
  createCellId,
  createChunkId,
  createLevelId,
  formatCellId,
  formatChunkId,
  formatLevelId,
  levelIdFromDepth,
  parseCellId,
  parseChunkId,
  parseLevelId,
} from '@/topology/lod/identifiers';

describe('LevelId', () => {
  it('formats and parses deterministically', () => {
    for (const name of ['global', 'regional', 'local'] as const) {
      const level = createLevelId(name);
      const formatted = formatLevelId(level);
      expect(parseLevelId(formatted)).toEqual(level);
    }
  });

  it('assigns strictly increasing depth from global to local', () => {
    expect(createLevelId('global').depth).toBe(0);
    expect(createLevelId('regional').depth).toBe(1);
    expect(createLevelId('local').depth).toBe(2);
  });

  it('resolves a level by depth and rejects unknown depths', () => {
    expect(levelIdFromDepth(1)).toEqual(createLevelId('regional'));
    expect(() => levelIdFromDepth(7)).toThrow(RangeError);
  });

  it('rejects malformed level identifiers', () => {
    expect(() => parseLevelId('lvl1-global')).toThrow(SyntaxError);
    expect(() => parseLevelId('not-a-level')).toThrow(SyntaxError);
  });
});

describe('CellId', () => {
  it('formats and parses root cells of the global level', () => {
    const cell = createCellId(createLevelId('global'), 5);
    const formatted = formatCellId(cell);
    expect(formatted).toBe('lvl0-global/root/c5');
    expect(parseCellId(formatted)).toEqual(cell);
  });

  it('formats and parses child cells with a parent reference', () => {
    const cell = createCellId(createLevelId('regional'), 12, 3);
    const formatted = formatCellId(cell);
    expect(formatted).toBe('lvl1-regional/p3/c12');
    expect(parseCellId(formatted)).toEqual(cell);
  });

  it('round-trips a child cell with parent index 0', () => {
    const cell = createCellId(createLevelId('regional'), 7, 0);
    const formatted = formatCellId(cell);
    expect(formatted).toBe('lvl1-regional/p0/c7');
    expect(parseCellId(formatted)).toEqual(cell);
    expect(parseCellId(formatted).parentIndex).toBe(0);
  });

  it('requires a parentIndex below the global level', () => {
    expect(() => createCellId(createLevelId('regional'), 0)).toThrow(RangeError);
  });

  it('forbids a parentIndex on the global level', () => {
    expect(() => createCellId(createLevelId('global'), 0, 1)).toThrow(RangeError);
  });

  it('rejects negative or non-integer indices', () => {
    expect(() => createCellId(createLevelId('global'), -1)).toThrow(RangeError);
    expect(() => createCellId(createLevelId('global'), 1.5)).toThrow(RangeError);
  });

  it('produces no collisions between cells of different levels or parents', () => {
    const ids = new Set<string>();
    for (const name of ['global', 'regional', 'local'] as const) {
      const level = createLevelId(name);
      const parentIndices = level.depth === 0 ? [null] : [0, 1, 2];
      for (const parentIndex of parentIndices) {
        for (let index = 0; index < 5; index += 1) {
          const cell = createCellId(level, index, parentIndex);
          const formatted = formatCellId(cell);
          expect(ids.has(formatted)).toBe(false);
          ids.add(formatted);
        }
      }
    }
  });
});

describe('ChunkId', () => {
  it('formats and parses deterministically', () => {
    const chunk = createChunkId(createLevelId('local'), 41);
    const formatted = formatChunkId(chunk);
    expect(formatted).toBe('lvl2-local/chunk-p41');
    expect(parseChunkId(formatted)).toEqual(chunk);
  });

  it('rejects chunking the global level', () => {
    expect(() => createChunkId(createLevelId('global'), 0)).toThrow(RangeError);
  });

  it('rejects malformed chunk identifiers', () => {
    expect(() => parseChunkId('lvl2-local/p41')).toThrow(SyntaxError);
  });
});
