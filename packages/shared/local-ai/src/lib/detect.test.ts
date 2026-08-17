// packages/shared/local-ai/src/lib/detect.test.ts
import { describe, expect, test } from 'bun:test';
import { detectHardware, parseNvidiaSmi, parseProcMeminfo } from './detect.ts';
import { createFixtureExecutor } from './fixture_executor.ts';
import type { ProbeResult } from './probe_executor.ts';

const ok = (stdout: string): ProbeResult => ({ ok: true, stdout, stderr: '', exitCode: 0 });

const NVIDIA_SINGLE = 'NVIDIA GeForce RTX 4070, 12282 MiB, 535.104.05\n';
const NVIDIA_MULTI = `NVIDIA GeForce RTX 4060, 8188 MiB, 535.104.05\nNVIDIA GeForce RTX 4090, 24564 MiB, 570.00\n`;

const CPU_EXECUTOR = createFixtureExecutor({
  table: {
    commands: [],
    files: [
      {
        path: '/proc/meminfo',
        result: ok('MemTotal:       32768 kB\nMemFree:        16384 kB\n'),
      },
    ],
    statfs: [{ path: '.', result: { freeBytes: 500 * 1024 * 1024 * 1024 } }],
  },
  unmatched: { ok: false, reason: 'not-found' },
});

const DOCKER_NVIDIA_EXECUTOR = createFixtureExecutor({
  table: {
    commands: [
      {
        command: 'nvidia-smi',
        args: ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader'],
        result: ok(NVIDIA_SINGLE),
      },
      { command: 'docker', args: ['info'], result: ok('Runtimes: nvidia runc') },
    ],
    files: [{ path: '/proc/meminfo', result: ok('MemTotal:       67108864 kB\n') }],
    statfs: [{ path: '.', result: { freeBytes: 1 << 40 } }],
  },
  unmatched: { ok: false, reason: 'not-found' },
});

describe('parseNvidiaSmi', () => {
  test('parses vendor VRAM and driver→CUDA major (535 → CUDA 12)', () => {
    const parsed = parseNvidiaSmi(NVIDIA_SINGLE);
    expect(parsed.name).toBe('NVIDIA GeForce RTX 4070');
    expect(parsed.vramMb).toBe(12282);
    expect(parsed.cudaMajor).toBe(12);
  });

  test('driver 570+ → CUDA 13', () => {
    const parsed = parseNvidiaSmi('NVIDIA GeForce RTX 5070, 12282 MiB, 570.00\n');
    expect(parsed.cudaMajor).toBe(13);
  });

  test('multi-GPU picks the largest device (AC-2 watch point)', () => {
    const parsed = parseNvidiaSmi(NVIDIA_MULTI);
    expect(parsed.name).toBe('NVIDIA GeForce RTX 4090');
    expect(parsed.vramMb).toBe(24564);
  });

  test('garbage input degrades to an empty profile', () => {
    expect(parseNvidiaSmi('not a csv')).toEqual({});
  });
});

describe('parseProcMeminfo', () => {
  test('parses MemTotal kB → MB', () => {
    expect(parseProcMeminfo('MemTotal:       67108864 kB\n')).toBe(65536);
  });
});

describe('AC-1 — detection degrades to CPU without error', () => {
  test('no GPU tooling on PATH → gpu.vendor none, containerRuntime none', async () => {
    const profile = await detectHardware({
      executor: CPU_EXECUTOR,
      platform: 'linux',
      arch: 'x64',
    });
    expect(profile.gpu.vendor).toBe('none');
    expect(profile.ramMb).toBe(32);
    expect(profile.containerRuntime).toBe('none');
    expect(profile.gpuPassthroughReady).toBe(false);
  });
});

describe('AC-2 — NVIDIA detection', () => {
  test('stubbed nvidia-smi + docker nvidia runtime → nvidia, CUDA 12, passthrough ready', async () => {
    const profile = await detectHardware({
      executor: DOCKER_NVIDIA_EXECUTOR,
      platform: 'linux',
      arch: 'x64',
    });
    expect(profile.gpu.vendor).toBe('nvidia');
    expect(profile.gpu.vramMb).toBe(12282);
    expect(profile.gpu.cudaMajor).toBe(12);
    expect(profile.containerRuntime).toBe('docker');
    expect(profile.gpuPassthroughReady).toBe(true);
  });

  test('CUDA 13 driver', async () => {
    const executor = createFixtureExecutor({
      table: {
        commands: [
          {
            command: 'nvidia-smi',
            args: ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader'],
            result: ok('NVIDIA GeForce RTX 5070, 12282 MiB, 580.00\n'),
          },
        ],
        files: [{ path: '/proc/meminfo', result: ok('MemTotal:       67108864 kB\n') }],
        statfs: [{ path: '.', result: { freeBytes: 1 << 40 } }],
      },
      unmatched: { ok: false, reason: 'not-found' },
    });
    const profile = await detectHardware({ executor, platform: 'linux', arch: 'x64' });
    expect(profile.gpu.cudaMajor).toBe(13);
  });
});

describe('AC-12 — NVIDIA GPU present, toolkit absent', () => {
  test('docker info without nvidia runtime → gpuPassthroughReady false', async () => {
    const executor = createFixtureExecutor({
      table: {
        commands: [
          {
            command: 'nvidia-smi',
            args: ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader'],
            result: ok(NVIDIA_SINGLE),
          },
          { command: 'docker', args: ['info'], result: ok('Runtimes: runc') },
        ],
        files: [{ path: '/proc/meminfo', result: ok('MemTotal:       67108864 kB\n') }],
        statfs: [{ path: '.', result: { freeBytes: 1 << 40 } }],
      },
      unmatched: { ok: false, reason: 'not-found' },
    });
    const profile = await detectHardware({ executor, platform: 'linux', arch: 'x64' });
    expect(profile.gpu.vendor).toBe('nvidia');
    expect(profile.gpuPassthroughReady).toBe(false);
    expect(profile.containerRuntime).toBe('docker');
  });
});

describe('Podman + NVIDIA CDI — gpuPassthroughReady without a named runtime', () => {
  // Podman (including Docker-compat shims common on NixOS) never lists a
  // distinct "nvidia" OCI runtime in `info` output the way Docker does —
  // it grants GPU access via a CDI spec file instead. A host with that
  // file present is genuinely GPU-ready even though the runtime-name
  // substring check alone would say otherwise (verified 2026-08-17
  // against a real NixOS + podman + CDI host that regressed to the CPU
  // fallback before this fix, despite a working GPU).
  test('podman info has no "nvidia" substring, but a CDI spec exists → passthrough ready', async () => {
    const executor = createFixtureExecutor({
      table: {
        commands: [
          {
            command: 'nvidia-smi',
            args: ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader'],
            result: ok(NVIDIA_SINGLE),
          },
          // "docker" here is Podman's docker-compat shim — succeeds, but
          // its info output is Podman's own shape (buildahVersion, conmon,
          // ociRuntime: runc, ...), never the string "nvidia".
          {
            command: 'docker',
            args: ['info'],
            result: ok(
              'buildahVersion: 1.43.2\nconmon:\n  version: 2.2.1\nociRuntime:\n  name: runc\n',
            ),
          },
        ],
        files: [
          { path: '/proc/meminfo', result: ok('MemTotal:       67108864 kB\n') },
          {
            path: '/etc/cdi/nvidia.yaml',
            result: ok('cdiVersion: "0.6.0"\nkind: nvidia.com/gpu\n'),
          },
        ],
        statfs: [{ path: '.', result: { freeBytes: 1 << 40 } }],
      },
      unmatched: { ok: false, reason: 'not-found' },
    });
    const profile = await detectHardware({ executor, platform: 'linux', arch: 'x64' });
    expect(profile.gpu.vendor).toBe('nvidia');
    expect(profile.containerRuntime).toBe('docker');
    expect(profile.gpuPassthroughReady).toBe(true);
  });

  test('no CDI spec anywhere and no named runtime → still not ready (AC-12 unchanged)', async () => {
    const executor = createFixtureExecutor({
      table: {
        commands: [
          {
            command: 'nvidia-smi',
            args: ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader'],
            result: ok(NVIDIA_SINGLE),
          },
          { command: 'docker', args: ['info'], result: ok('ociRuntime:\n  name: runc\n') },
        ],
        files: [{ path: '/proc/meminfo', result: ok('MemTotal:       67108864 kB\n') }],
        statfs: [{ path: '.', result: { freeBytes: 1 << 40 } }],
      },
      unmatched: { ok: false, reason: 'not-found' },
    });
    const profile = await detectHardware({ executor, platform: 'linux', arch: 'x64' });
    expect(profile.gpuPassthroughReady).toBe(false);
  });
});

describe('Apple detection (AC-4)', () => {
  test('darwin → apple vendor, unified memory, RAM from sysctl', async () => {
    const executor = createFixtureExecutor({
      table: {
        commands: [
          { command: 'sysctl', args: ['hw.memsize'], result: ok('17179869184\n') },
          // -n prints the value, but a host may echo the key anyway — the
          // fixture proves detect() extracts digits instead of parsing the line.
          { command: 'sysctl', args: ['-n', 'hw.ncpu'], result: ok('hw.ncpu: 10\n') },
        ],
        files: [],
        statfs: [{ path: '.', result: { freeBytes: 1 << 40 } }],
      },
      unmatched: { ok: false, reason: 'not-found' },
    });
    const profile = await detectHardware({ executor, platform: 'darwin', arch: 'arm64' });
    expect(profile.gpu.vendor).toBe('apple');
    expect(profile.gpu.unifiedMemory).toBe(true);
    expect(profile.ramMb).toBe(16384);
    expect(profile.cores).toBe(10);
  });
});

describe('Windows detection', () => {
  test('win32 prefers PowerShell CIM for RAM', async () => {
    const executor = createFixtureExecutor({
      table: {
        commands: [
          {
            command: 'powershell',
            args: [
              '-NoProfile',
              '-Command',
              '(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory',
            ],
            result: ok('17179869184\n'),
          },
          // win32 cores come from PowerShell, not nproc (which doesn't exist).
          {
            command: 'powershell',
            args: [
              '-NoProfile',
              '-Command',
              '(Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors',
            ],
            result: ok('16\n'),
          },
        ],
        files: [],
        statfs: [{ path: '.', result: { freeBytes: 1 << 40 } }],
      },
      unmatched: { ok: false, reason: 'not-found' },
    });
    const profile = await detectHardware({ executor, platform: 'win32', arch: 'x64' });
    expect(profile.ramMb).toBe(16384);
    expect(profile.cores).toBe(16);
  });
});
