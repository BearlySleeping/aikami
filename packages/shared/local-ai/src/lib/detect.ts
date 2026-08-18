// packages/shared/local-ai/src/lib/detect.ts
//
// Hardware detection written ONLY against the ProbeExecutor seam — no
// process spawning in the core. Every probe is individually capped at 1 s
// and non-fatal: a missing binary, a hang, or a permission denial degrades
// to a partial profile and the caller still gets a usable `cpu` plan.
//
// Platform/arch come from the adapter (Bun passes process.platform/arch; a
// Tauri host passes its own; fixtures pass fixed values) so the core stays
// free of node:os.

import type { GpuVendor, HardwareProfile } from '@aikami/types';
import type { ProbeExecutor, ProbeResult } from './probe_executor.ts';

export const PROBE_TIMEOUT_MS = 1000;

export type DetectOptions = {
  readonly executor: ProbeExecutor;
  readonly platform: 'linux' | 'darwin' | 'win32';
  readonly arch: 'x64' | 'arm64';
  /** Volume path used for the free-disk probe (defaults to process cwd). */
  readonly diskPath?: string;
};

/** Runs a command probe and returns a safe default when it fails. */
const probe = async (
  executor: ProbeExecutor,
  command: string,
  args: readonly string[],
): Promise<ProbeResult> => executor.run(command, args, { timeoutMs: PROBE_TIMEOUT_MS });

/**
 * Parses `nvidia-smi --query-gpu=name,memory.total,driver_version` output.
 * Multi-GPU: pick the largest single device (engines use one device;
 * summing VRAM across cards would over-recommend — C-391 Watch Points).
 */
export const parseNvidiaSmi = (
  stdout: string,
): {
  readonly name?: string;
  readonly vramMb?: number;
  readonly cudaMajor?: 12 | 13;
} => {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  let best: { name?: string; vramMb?: number; cudaMajor?: 12 | 13 } | undefined;
  for (const line of lines) {
    const parts = line.split(',').map((part) => part.trim());
    if (parts.length < 2) {
      continue; // not an nvidia-smi CSV row
    }
    const [name, memRaw, driverRaw] = parts;
    const memMatch = memRaw?.match(/^(\d+)\s*MiB$/);
    const vramMb = memMatch ? Number(memMatch[1]) : undefined;
    // Driver major decides CUDA 12 vs 13: CUDA 13 requires driver >= 570.
    const driverMajor = Number.parseInt(driverRaw ?? '', 10);
    let cudaMajor: 12 | 13 | undefined;
    if (Number.isNaN(driverMajor)) {
      cudaMajor = undefined;
    } else if (driverMajor >= 570) {
      cudaMajor = 13;
    } else {
      cudaMajor = 12;
    }
    const candidate = { name, vramMb, cudaMajor };
    if (!best || (vramMb ?? 0) > (best.vramMb ?? 0)) {
      best = candidate;
    }
  }
  return best ?? {};
};

/**
 * Parses `/proc/meminfo` into total RAM MB.
 */
export const parseProcMeminfo = (stdout: string): number => {
  const match = stdout.match(/^MemTotal:\s*(\d+)\s*kB/m);
  if (!match) {
    return 0;
  }
  return Math.floor(Number(match[1]) / 1024);
};

/**
 * Well-known NVIDIA CDI (Container Device Interface) spec locations —
 * Podman's GPU-readiness signal, since it has no named "nvidia" runtime the
 * way Docker does (see the gpuPassthroughReady call site). Checked in
 * order; the first one found wins. Covers `nvidia-ctk cdi generate`'s own
 * default (`/etc/cdi/nvidia.yaml`) and NixOS's
 * `hardware.nvidia-container-toolkit` module's dynamic path
 * (`/var/run/cdi/nvidia-container-toolkit.json`, verified 2026-08-17).
 */
export const NVIDIA_CDI_SPEC_PATHS = [
  '/etc/cdi/nvidia.yaml',
  '/etc/cdi/nvidia.json',
  '/var/run/cdi/nvidia.yaml',
  '/var/run/cdi/nvidia.json',
  '/var/run/cdi/nvidia-container-toolkit.json',
] as const;

/** True when any known NVIDIA CDI spec file is readable. */
export const hasNvidiaCdiSpec = async (executor: ProbeExecutor): Promise<boolean> => {
  for (const path of NVIDIA_CDI_SPEC_PATHS) {
    const result = await executor.readTextFile(path);
    if (result.ok) {
      return true;
    }
  }
  return false;
};

/**
 * Parses `sysctl hw.memsize` (Darwin) — bytes on one line.
 */
export const parseSysctlMemsize = (stdout: string): number => {
  const match = stdout.match(/(\d+)/);
  if (!match) {
    return 0;
  }
  return Math.floor(Number(match[1]) / 1024 / 1024);
};

/**
 * Parses PowerShell `Get-CimInstance Win32_ComputerSystem` TotalPhysicalMemory
 * (bytes; wmic fallback prints the same number).
 */
export const parseWinTotalMemory = (stdout: string): number => {
  const match = stdout.match(/(\d+)/);
  if (!match) {
    return 0;
  }
  return Math.floor(Number(match[1]) / 1024 / 1024);
};

/**
 * Runs every probe and assembles the HardwareProfile. No probe failure
 * aborts detection — the profile degrades field by field (AC-1).
 *
 * @param options — executor, platform, arch, optional disk path.
 * @returns The assembled profile.
 */
export const detectHardware = async (options: DetectOptions): Promise<HardwareProfile> => {
  const { executor, platform, arch, diskPath } = options;
  let gpuVendor: GpuVendor = 'none';
  let gpuName: string | undefined;
  let vramMb: number | undefined;
  let cudaMajor: 12 | 13 | undefined;
  let unifiedMemory = false;
  let ramMb = 0;
  let cores = 0;
  let containerRuntime: HardwareProfile['containerRuntime'] = 'none';
  let gpuPassthroughReady = false;

  if (platform === 'darwin') {
    gpuVendor = 'apple';
    unifiedMemory = true;
  }

  let freeDiskBytes = 0;

  // Independent probe groups run concurrently: GPU vendor detection (a
  // sequential fallback chain — AMD/Vulkan only probed when nothing matched),
  // RAM, cores, disk, and the container runtime. The runtime probe
  // short-circuits: podman is only probed when the docker probe fails.
  await Promise.all([
    (async () => {
      // ── NVIDIA ────────────────────────────────────────────────────────
      const nvidia = await probe(executor, 'nvidia-smi', [
        '--query-gpu=name,memory.total,driver_version',
        '--format=csv,noheader',
      ]);
      if (nvidia.ok) {
        const parsed = parseNvidiaSmi(nvidia.stdout);
        if (parsed.vramMb !== undefined || parsed.name !== undefined) {
          gpuVendor = 'nvidia';
          gpuName = parsed.name;
          vramMb = parsed.vramMb;
          cudaMajor = parsed.cudaMajor;
        }
      }

      // ── AMD ───────────────────────────────────────────────────────────
      if (gpuVendor === 'none') {
        const rocm = await probe(executor, 'rocm-smi', ['--showmeminfo', 'vram']);
        if (rocm.ok && rocm.stdout.includes('vram')) {
          gpuVendor = 'amd';
          const vramMatch = rocm.stdout.match(/vram\s*\(.*\)\s*:\s*(\d+)/i);
          if (vramMatch) {
            vramMb = Number(vramMatch[1]);
          }
        }
      }

      // ── Vulkan (Intel Arc / iGPU / unknown GPU) ───────────────────────
      if (gpuVendor === 'none') {
        const vulkan = await probe(executor, 'vulkaninfo', ['--summary']);
        if (vulkan.ok) {
          const summary = vulkan.stdout.toLowerCase();
          if (summary.includes('nvidia')) {
            gpuVendor = 'nvidia';
            unifiedMemory = false;
          } else if (summary.includes('amd') || summary.includes('advanced micro devices')) {
            gpuVendor = 'amd';
          } else if (summary.includes('intel')) {
            gpuVendor = 'intel';
            unifiedMemory = true;
          } else {
            // A generic Vulkan device with no vendor match — treat as intel/iGPU
            // (universal fallback) rather than assuming a dGPU.
            gpuVendor = 'intel';
            unifiedMemory = true;
          }
        }
      }
    })(),

    (async () => {
      // ── RAM ───────────────────────────────────────────────────────────
      if (platform === 'linux') {
        const meminfo = await executor.readTextFile('/proc/meminfo');
        if (meminfo.ok) {
          ramMb = parseProcMeminfo(meminfo.stdout);
        }
      } else if (platform === 'darwin') {
        const memsize = await probe(executor, 'sysctl', ['hw.memsize']);
        if (memsize.ok) {
          ramMb = parseSysctlMemsize(memsize.stdout);
        }
      } else {
        // win32: prefer PowerShell CIM; wmic is deprecated on Windows 11.
        const cim = await probe(executor, 'powershell', [
          '-NoProfile',
          '-Command',
          '(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory',
        ]);
        if (cim.ok) {
          ramMb = parseWinTotalMemory(cim.stdout);
        } else {
          const wmic = await probe(executor, 'wmic', [
            'ComputerSystem',
            'get',
            'TotalPhysicalMemory',
            '/value',
          ]);
          if (wmic.ok) {
            ramMb = parseWinTotalMemory(wmic.stdout);
          }
        }
      }
    })(),

    (async () => {
      // ── Cores ─────────────────────────────────────────────────────────
      if (platform === 'linux') {
        const nproc = await probe(executor, 'nproc', []);
        if (nproc.ok) {
          const digits = nproc.stdout.match(/\d+/)?.[0];
          cores = digits ? Number.parseInt(digits, 10) || 0 : 0;
        }
      } else if (platform === 'darwin') {
        // `-n` prints just the value; some hosts still echo the key —
        // extract digits, never parse the whole line.
        const ncpu = await probe(executor, 'sysctl', ['-n', 'hw.ncpu']);
        if (ncpu.ok) {
          const digits = ncpu.stdout.match(/\d+/)?.[0];
          cores = digits ? Number.parseInt(digits, 10) || 0 : 0;
        }
      } else {
        // win32: `nproc` does not exist — use PowerShell's CIM query.
        const cpuCount = await probe(executor, 'powershell', [
          '-NoProfile',
          '-Command',
          '(Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors',
        ]);
        if (cpuCount.ok) {
          const digits = cpuCount.stdout.match(/\d+/)?.[0];
          cores = digits ? Number.parseInt(digits, 10) || 0 : 0;
        }
      }
    })(),

    (async () => {
      // ── Disk (volume backing the target path) ─────────────────────────
      const statfs = await executor.statfs(diskPath ?? '.');
      if ('freeBytes' in statfs) {
        freeDiskBytes = statfs.freeBytes;
      }
    })(),

    (async () => {
      // ── Container runtime + GPU passthrough ───────────────────────────
      // podman is only probed when docker is unavailable (short-circuit).
      // Many "docker" binaries on Linux are actually Podman's docker-compat
      // shim (common on NixOS) — `docker info`/`podman info` succeeds
      // either way, but the two report GPU readiness completely
      // differently: real Docker (with nvidia-container-runtime) lists a
      // distinct "nvidia" OCI runtime in its info output, which is what
      // the plain substring check below catches. Podman never does this —
      // it grants GPU access via CDI (Container Device Interface) device
      // specs instead, which show up nowhere in `podman info`. Checking
      // only the runtime-name substring therefore false-negatives on every
      // Podman host with CDI configured (verified 2026-08-17: a working
      // NixOS + podman + CDI setup reported gpuPassthroughReady: false,
      // sending every user through the CPU fallback despite a ready GPU).
      // A CDI spec file existing is the Podman-side signal to check
      // instead; only relevant on Linux, where CDI lives.
      const docker = await probe(executor, 'docker', ['info']);
      if (docker.ok) {
        containerRuntime = 'docker';
        gpuPassthroughReady = docker.stdout.toLowerCase().includes('nvidia');
      } else {
        const podman = await probe(executor, 'podman', ['info']);
        if (podman.ok) {
          containerRuntime = 'podman';
          gpuPassthroughReady = podman.stdout.toLowerCase().includes('nvidia');
        }
      }
      if (!gpuPassthroughReady && platform === 'linux') {
        gpuPassthroughReady = await hasNvidiaCdiSpec(executor);
      }
    })(),
  ]);

  return {
    platform,
    arch,
    gpu: {
      vendor: gpuVendor,
      name: gpuName,
      vramMb,
      cudaMajor,
      unifiedMemory,
    },
    ramMb,
    cores,
    freeDiskBytes,
    containerRuntime,
    gpuPassthroughReady,
  };
};
