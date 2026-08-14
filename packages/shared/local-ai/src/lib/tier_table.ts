// packages/shared/local-ai/src/lib/tier_table.ts
//
// Tier thresholds live IN CODE as a typed constant, per the C-391 design
// reference — C-390's manifest keeps its per-entry `tier` labels and is not
// edited by this contract. The manifest vocabulary (`cpu` / `8gb` / `16gb` /
// `any`) is what this table maps onto.
//
// Headroom rule: usable VRAM = 70% of reported VRAM for dedicated GPUs;
// usable memory = 50% of total RAM for unified-memory systems (Apple
// Silicon, iGPUs). A manifest entry is eligible only when its file size ≤
// usable bytes. The thresholds below define when a given usable size reaches
// each tier; the manifest entry itself still has to fit inside usable bytes.

const GIB = 1024 * 1024 * 1024;

export type TierLabel = 'cpu' | '8gb' | '16gb' | 'any';

export type TierRow = {
  /** Minimum usable bytes for this tier to be reachable. */
  readonly minUsableBytes: number;
  readonly tier: Extract<TierLabel, 'cpu' | '8gb' | '16gb'>;
};

/**
 * Usable-memory thresholds for each model tier. Sorted ascending.
 *
 * Calibrated so a card is nominally in the tier whose smallest model it can
 * hold comfortably: 4 GiB usable (≈ an 8 GB card after 70% headroom, and
 * enough for the smallest 8gb-tier model) reaches `8gb`; 10 GiB usable
 * (≈ a 16 GB card, comfortably above the largest shipped 16gb-tier model)
 * reaches `16gb`. A 12 GB card (8.4 GB usable) stays nominal `8gb`, so a
 * 16gb-tier pick there warns as a top-tier fallback (AC-3).
 */
export const TIER_TABLE: readonly TierRow[] = [
  { minUsableBytes: 0, tier: 'cpu' },
  { minUsableBytes: 4 * GIB, tier: '8gb' },
  { minUsableBytes: 10 * GIB, tier: '16gb' },
] as const;

/** Fraction of reported VRAM treated as usable on dedicated GPUs. */
export const DEDICATED_GPU_HEADROOM = 0.7;
/** Fraction of total memory treated as usable on unified-memory systems. */
export const UNIFIED_MEMORY_HEADROOM = 0.5;

/**
 * Maps usable bytes to the largest tier reachable at or below that size.
 * The `any` tier is always reachable (tiny voice/stt models).
 *
 * @param usableBytes — Usable VRAM or usable unified memory.
 * @returns The tier label the usable size nominally supports.
 */
export const tierForUsable = (usableBytes: number): TierLabel => {
  let tier: TierLabel = 'cpu';
  for (const row of TIER_TABLE) {
    if (usableBytes >= row.minUsableBytes) {
      tier = row.tier;
    }
  }
  return tier;
};

/**
 * Orders tier labels for "largest first" iteration. `any` sorts below the
 * fixed tiers — a dedicated entry always wins over the universal fallback.
 */
export const tierRank = (tier: TierLabel): number => {
  switch (tier) {
    case '16gb':
      return 3;
    case '8gb':
      return 2;
    case 'cpu':
      return 1;
    case 'any':
      return 0;
  }
};

/**
 * Usable bytes for a hardware profile: dedicated GPUs use 70% of VRAM
 * (headroom for the compositor and a busy desktop); unified-memory systems
 * use 50% of total RAM (shared with the OS). A CPU-only profile (no GPU)
 * sizes models against usable system RAM so the CPU backend still picks a
 * sane default.
 *
 * @returns Usable bytes for model sizing.
 */
export const usableBytesForProfile = (options: {
  readonly gpuVendor: 'nvidia' | 'amd' | 'intel' | 'apple' | 'none';
  readonly vramMb?: number;
  readonly ramMb: number;
  readonly unifiedMemory: boolean;
}): number => {
  const { gpuVendor, vramMb, ramMb, unifiedMemory } = options;
  if (unifiedMemory) {
    return Math.floor(ramMb * 1024 * 1024 * UNIFIED_MEMORY_HEADROOM);
  }
  if (gpuVendor !== 'none' && vramMb !== undefined && vramMb > 0) {
    return Math.floor(vramMb * 1024 * 1024 * DEDICATED_GPU_HEADROOM);
  }
  // CPU-only: models live in system RAM; use the same unified headroom so a
  // 16 GB machine does not try to fit a 12 GB model into swap.
  return Math.floor(ramMb * 1024 * 1024 * UNIFIED_MEMORY_HEADROOM);
};
