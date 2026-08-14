// packages/shared/local-ai/src/lib/recommend.ts
//
// Pure recommendation: (HardwareProfile, StackModality[], ModelManifest) →
// StackPlan. No I/O, no process spawning, no container assumptions — the
// tier table and headroom rules from the C-391 design reference.
//
// Selection rule: usable bytes come from the headroom rule (70% of VRAM for
// dedicated GPUs, 50% of RAM for unified memory / CPU-only); a manifest
// entry is eligible only when bytes ≤ usable; the selection is the largest
// manifest tier whose entry fits. Selecting a tier above the machine's
// nominal tier (per TIER_TABLE) warns as a top-tier fallback — the model
// fits, but barely, and the user deserves to know before downloading 7 GB.

import type {
  GpuVendor,
  HardwareProfile,
  ModelManifest,
  StackModality,
  StackPlan,
} from '@aikami/types';
import type { TierLabel } from './tier_table.ts';
import { tierForUsable, tierRank, usableBytesForProfile } from './tier_table.ts';

export type RecommendOptions = {
  readonly profile: HardwareProfile;
  readonly modalities: readonly StackModality[];
  readonly manifest: ModelManifest;
  /** Explicit backend override (--backend). Defaults to auto-detection. */
  readonly backendOverride?: StackPlan['backend'];
  /**
   * Explicit tier override (--tier cpu|8gb|16gb). When set, the largest
   * entry at or below that tier is selected regardless of the machine's
   * nominal tier (CI / power users pinning a specific size).
   */
  readonly tierOverride?: 'cpu' | '8gb' | '16gb';
};

/** User-facing modality → manifest modality. `web`/`ollama`/`comfyui` have no models. */
const MANIFEST_MODALITY: Readonly<Record<StackModality, string | undefined>> = {
  text: 'text',
  image: 'image',
  voice: 'tts',
  stt: 'stt',
  web: undefined,
  ollama: undefined,
  comfyui: undefined,
} as const;

const TIER_ORDER: readonly Extract<TierLabel, 'cpu' | '8gb' | '16gb'>[] = ['16gb', '8gb', 'cpu'];

/** Warning text when no container runtime was detected. */
const NO_RUNTIME_WARNING =
  'No container runtime detected (docker or podman). The stack needs one to run engines; install Docker before `docker compose up`.';

/** Converts a size to a human "X.X GB" string for rationale lines. */
const formatGb = (bytes: number): string => `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;

/** True when the profile is a unified-memory system (Apple Silicon, iGPU). */
const isUnifiedMemory = (profile: HardwareProfile): boolean =>
  profile.gpu.unifiedMemory || profile.gpu.vendor === 'apple';

/**
 * Picks the best entry for one modality from the manifest under the headroom
 * rule. Returns the entry and the tier it resolved to, plus a warning when
 * the selection sits above the machine's nominal tier.
 */
const selectEntry = (options: {
  readonly manifest: ModelManifest;
  readonly manifestModality: string;
  readonly usableBytes: number;
  readonly nominalTier: TierLabel;
  readonly profileName: string;
  /** When set, never select above this tier (--tier override). */
  readonly tierCap?: 'cpu' | '8gb' | '16gb';
}):
  | {
      readonly entry: ModelManifest['entries'][number];
      readonly warning?: string;
    }
  | undefined => {
  const { manifestModality, usableBytes, nominalTier } = options;
  const entries = options.manifest.entries.filter((entry) => entry.modality === manifestModality);
  if (entries.length === 0) {
    return undefined;
  }

  // Any-tier entries (tiny voice/stt archives) are always eligible and are
  // the natural pick for their modality when nothing bigger fits. A sole
  // oversized any-tier entry must warn exactly like the fallback path below,
  // so the user learns about the tight fit before the download starts.
  const anyEntry = entries.find((entry) => entry.tier === 'any');
  if (anyEntry && (entries.length === 1 || anyEntry.bytes <= usableBytes)) {
    if (anyEntry.bytes > usableBytes) {
      return {
        entry: anyEntry,
        warning: `${options.profileName} model ${anyEntry.id} (${formatGb(anyEntry.bytes)}) does not comfortably fit ${formatGb(usableBytes)} usable — selecting it anyway as the smallest available.`,
      };
    }
    return { entry: anyEntry };
  }

  // Largest-tier entry that fits inside usable bytes.
  for (const tier of TIER_ORDER) {
    if (options.tierCap && tierRank(tier) > tierRank(options.tierCap)) {
      continue;
    }
    const fitting = entries
      .filter((entry) => entry.tier === tier && entry.bytes <= usableBytes)
      .sort((a, b) => b.bytes - a.bytes);
    const best = fitting[0];
    if (best) {
      if (tierRank(tier) > tierRank(nominalTier)) {
        return {
          entry: best,
          warning: `${options.profileName} model ${best.id} (${formatGb(best.bytes)}) fits in ${formatGb(usableBytes)} usable, but that is above this machine's nominal ${nominalTier} tier — expect a tight fit.`,
        };
      }
      return { entry: best };
    }
  }

  // Nothing fits usable bytes — fall back to the smallest entry and warn.
  const smallest = [...entries].sort((a, b) => a.bytes - b.bytes)[0];
  if (smallest) {
    return {
      entry: smallest,
      warning: `${options.profileName} model ${smallest.id} (${formatGb(smallest.bytes)}) does not comfortably fit ${formatGb(usableBytes)} usable — selecting it anyway as the smallest available.`,
    };
  }
  return undefined;
};

/** Selects the backend from the profile unless the user overrode it. */
const selectBackend = (options: {
  readonly profile: HardwareProfile;
  readonly override?: StackPlan['backend'];
}): { readonly backend: StackPlan['backend']; readonly warnings: readonly string[] } => {
  const { profile, override } = options;
  const warnings: string[] = [];

  // The container-runtime warning applies to EVERY container-based backend
  // (cpu/cuda/rocm/vulkan/intel/musa), not only CPU-only profiles: a CUDA
  // pick with no docker/podman would fail at `up` just the same. Metal is
  // the native runtime and never needs the warning.
  const warnIfNoRuntime = (backend: StackPlan['backend']): void => {
    if (backend !== 'metal' && profile.containerRuntime === 'none') {
      warnings.push(NO_RUNTIME_WARNING);
    }
  };

  if (override) {
    if (override === 'cuda' && profile.gpu.vendor !== 'nvidia' && profile.platform !== 'win32') {
      warnings.push(
        `--backend cuda requested on a ${profile.gpu.vendor === 'none' ? 'machine with no NVIDIA GPU' : `${profile.gpu.vendor} GPU`} — obeying the override, but the container will not have GPU access.`,
      );
    }
    if (override === 'metal' && profile.platform !== 'darwin') {
      warnings.push(
        '--backend metal requested on a non-macOS host — native launchers will not run here.',
      );
    }
    warnIfNoRuntime(override);
    return { backend: override, warnings };
  }

  if (profile.platform === 'darwin') {
    return { backend: 'metal', warnings };
  }

  let backend: StackPlan['backend'];
  switch (profile.gpu.vendor) {
    case 'nvidia': {
      if (!profile.gpuPassthroughReady) {
        warnings.push(
          'NVIDIA GPU detected but the NVIDIA Container Toolkit is not wired into the container runtime — GPU containers would fail at `up`. Falling back to CPU. Install the toolkit: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html',
        );
        backend = 'cpu';
      } else {
        backend = 'cuda';
      }
      break;
    }
    case 'amd':
      backend = 'rocm';
      break;
    case 'intel':
      backend = 'vulkan';
      break;
    case 'apple':
      backend = 'metal';
      break;
    case 'none':
      backend = 'cpu';
      break;
  }
  warnIfNoRuntime(backend);
  return { backend, warnings };
};

/**
 * Computes the plan: backend, per-modality model picks with rationale,
 * total download, and warnings.
 *
 * @param options — profile, requested modalities, manifest, optional override.
 * @returns The validated plan.
 */
export const recommend = (options: RecommendOptions): StackPlan => {
  const { profile, modalities, manifest, backendOverride, tierOverride } = options;

  const usableBytes = usableBytesForProfile({
    gpuVendor: profile.gpu.vendor,
    vramMb: profile.gpu.vramMb,
    ramMb: profile.ramMb,
    unifiedMemory: isUnifiedMemory(profile),
  });
  const nominalTier = tierOverride ?? tierForUsable(usableBytes);
  const warnings: string[] = [];

  const { backend, warnings: backendWarnings } = selectBackend({
    profile,
    override: backendOverride,
  });
  warnings.push(...backendWarnings);

  const models: StackPlan['models'] = [];
  for (const modality of modalities) {
    const manifestModality = MANIFEST_MODALITY[modality];
    if (!manifestModality) {
      continue; // web / ollama / comfyui — no models to download
    }
    const picked = selectEntry({
      manifest,
      manifestModality,
      usableBytes,
      nominalTier,
      profileName: modality,
      tierCap: tierOverride,
    });
    if (!picked) {
      warnings.push(`no manifest entry for modality ${modality}`);
      continue;
    }
    if (picked.warning) {
      warnings.push(picked.warning);
    }
    const entry = picked.entry;
    models.push({
      manifestId: entry.id,
      modality,
      bytes: entry.bytes,
      license: entry.license,
      requiresAcknowledgement: entry.requiresAcknowledgement,
      rationale:
        entry.tier === 'any'
          ? 'universal tier — fits anywhere'
          : `${formatGb(usableBytes)} usable → tier ${entry.tier} (${formatGb(entry.bytes)})`,
    });
  }

  if (models.length === 0 && modalities.length > 0) {
    warnings.push('no models selected for the requested modalities');
  }

  const totalDownloadBytes = models.reduce((sum, model) => sum + model.bytes, 0);
  const nativeEngines = backend === 'metal';

  return {
    backend,
    modalities: [...modalities],
    models,
    totalDownloadBytes,
    warnings,
    nativeEngines,
  };
};

/** Convenience type guard for the GPU vendor union. */
export const isGpuVendor = (value: string): value is GpuVendor =>
  value === 'nvidia' ||
  value === 'amd' ||
  value === 'intel' ||
  value === 'apple' ||
  value === 'none';
