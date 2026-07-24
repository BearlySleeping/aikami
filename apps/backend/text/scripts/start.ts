// apps/backend/text/scripts/start.ts
// Native Shimmy inference server runner for Aikami.

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $ } from 'bun';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, '..');

const SHIMMY_PORT = process.env.SHIMMY_PORT || '11435';
const SHIMMY_HOST = process.env.SHIMMY_HOST || '0.0.0.0';
const MODELS_DIR = process.env.SHIMMY_BASE_GGUF || resolve(PROJECT_DIR, 'src/cache/models');
const SHIMMY_BIN = resolve(PROJECT_DIR, 'src/cache/shimmy');

// Read version
const versionPath = resolve(PROJECT_DIR, '.shimmy-version');
const shimmyVersion = existsSync(versionPath)
  ? readFileSync(versionPath, 'utf-8').trim()
  : 'v2.3.0';

// ── 1. Download / Cache Shimmy Binary ───────────────────────
if (!existsSync(SHIMMY_BIN)) {
  const url = `https://github.com/Michael-A-Kuykendall/shimmy/releases/download/${shimmyVersion}/shimmy-linux-x86_64`;
  console.log(`📥 Downloading shimmy ${shimmyVersion}...`);
  await $`curl -fsSL ${url} -o ${SHIMMY_BIN}`;
  await $`chmod +x ${SHIMMY_BIN}`;
  console.log('✓ Shimmy binary cached');
}

// ── 2. Find GGUF Model ──────────────────────────────────────
const findModel = (): string | null => {
  try {
    if (existsSync(MODELS_DIR) && MODELS_DIR.endsWith('.gguf')) {
      return MODELS_DIR;
    }
    const files = readdirSync(MODELS_DIR);
    const gguf = files.find((f) => f.endsWith('.gguf'));
    return gguf ? resolve(MODELS_DIR, gguf) : null;
  } catch {
    return null;
  }
};

const modelFile = findModel();

if (!modelFile) {
  console.error(`✗ No .gguf model found in ${MODELS_DIR}`);
  console.error('  Download one with: bun run download:model --tiny');
  process.exit(1);
}

// ── 3. Resolve Vulkan & Driver Paths ─────────────────────────
const findVulkanLoaderDir = (): string | null => {
  const ldPaths = (process.env.LD_LIBRARY_PATH ?? '').split(':');
  for (const p of ldPaths) {
    if (p && existsSync(resolve(p, 'libvulkan.so.1'))) {
      return p;
    }
  }
  try {
    const result = execSync(
      'ls /nix/store/*vulkan-loader*/lib/libvulkan.so.1 2>/dev/null | head -1',
      { timeout: 3000, encoding: 'utf-8' },
    ).trim();
    if (result) {
      return dirname(result);
    }
  } catch {
    // not found
  }
  return null;
};

const findNvidiaIcd = (): string | null => {
  const candidates = [
    '/run/opengl-driver/share/vulkan/icd.d/nvidia_icd.x86_64.json',
    '/run/opengl-driver/share/vulkan/icd.d/nvidia_icd.json',
    '/usr/share/vulkan/icd.d/nvidia_icd.json',
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return null;
};

const buildLdLibraryPath = (): string => {
  const paths: string[] = [];

  if (existsSync('/run/opengl-driver/lib')) {
    paths.push('/run/opengl-driver/lib');
  }

  const vulkanDir = findVulkanLoaderDir();
  if (vulkanDir) {
    paths.push(vulkanDir);
  }

  if (process.env.LD_LIBRARY_PATH) {
    paths.push(process.env.LD_LIBRARY_PATH);
  }

  return Array.from(new Set(paths.filter(Boolean))).join(':');
};

const ldLibPath = buildLdLibraryPath();
const nvidiaIcd = findNvidiaIcd();

// ── 4. Build Environment Variables ───────────────────────────
const envVars: Record<string, string> = {
  ...process.env,
  SHIMMY_BASE_GGUF: modelFile,
  SHIMMY_MODEL_PATHS: MODELS_DIR,
  XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || '/tmp',
  WGPU_POWER_PREF: 'high-performance',
  WGPU_ADAPTER_NAME: process.env.WGPU_ADAPTER_NAME || 'NVIDIA',

  // Enforce NVIDIA PRIME Render Offload
  __NV_PRIME_RENDER_OFFLOAD: '1',
  __NV_PRIME_RENDER_OFFLOAD_PROVIDER: 'NVIDIA-G0',
  __GLX_VENDOR_LIBRARY_NAME: 'nvidia',
  DRI_PRIME: '1',

  LD_LIBRARY_PATH: ldLibPath,
  ...(nvidiaIcd ? { VK_ICD_FILENAMES: nvidiaIcd, VK_DRIVER_FILES: nvidiaIcd } : {}),
};

console.log('========================================');
console.log(`🚀 Starting Shimmy (${shimmyVersion}) on ${SHIMMY_HOST}:${SHIMMY_PORT}...`);
console.log(`📦 Model: ${modelFile}`);
console.log(`⚡ LD_LIBRARY_PATH: ${ldLibPath}`);
if (nvidiaIcd) console.log(`🎯 NVIDIA Vulkan ICD: ${nvidiaIcd}`);
console.log('========================================\n');

// ── 5. Execute Shimmy ────────────────────────────────────────
const kvQuant = process.env.SHIMMY_KV_QUANT || 'int4';

await $`${SHIMMY_BIN} serve --bind ${SHIMMY_HOST}:${SHIMMY_PORT} --kv-quant ${kvQuant}`.env(
  envVars,
);
