// packages/shared/local-ai/src/lib/tier_table.test.ts
import { describe, expect, test } from 'bun:test';
import { TIER_TABLE, tierForUsable, usableBytesForProfile } from './tier_table.ts';

describe('TIER_TABLE', () => {
  test('is sorted ascending by minUsableBytes', () => {
    for (let i = 1; i < TIER_TABLE.length; i += 1) {
      expect(TIER_TABLE[i]?.minUsableBytes ?? 0).toBeGreaterThan(
        TIER_TABLE[i - 1]?.minUsableBytes ?? 0,
      );
    }
  });

  test('starts at cpu with zero usable bytes', () => {
    expect(tierForUsable(0)).toBe('cpu');
  });
});

describe('usableBytesForProfile', () => {
  test('dedicated GPU uses 70% of VRAM', () => {
    const usable = usableBytesForProfile({
      gpuVendor: 'nvidia',
      vramMb: 12282,
      ramMb: 32768,
      unifiedMemory: false,
    });
    // 12282 MiB * 0.7
    expect(usable).toBe(Math.floor(12282 * 1024 * 1024 * 0.7));
  });

  test('unified memory uses 50% of total RAM', () => {
    const usable = usableBytesForProfile({
      gpuVendor: 'apple',
      ramMb: 16384,
      unifiedMemory: true,
    });
    // 16 GiB * 0.5
    expect(usable).toBe(Math.floor(16384 * 1024 * 1024 * 0.5));
  });

  test('CPU-only falls back to unified-memory sizing on system RAM', () => {
    const usable = usableBytesForProfile({
      gpuVendor: 'none',
      ramMb: 16384,
      unifiedMemory: false,
    });
    expect(usable).toBe(Math.floor(16384 * 1024 * 1024 * 0.5));
  });
});
