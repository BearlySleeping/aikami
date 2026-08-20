// apps/backend/local-stack/src/scripts/native/run_tts.ts
//
// Native host launcher for local text-to-speech (TTS) without Docker
// (was bin/run-native-tts.sh).
//
// Runs the sherpa-onnx Kokoro TTS behind an OpenAI-compatible
// /v1/audio/speech HTTP endpoint (the API the Aikami client calls).
//
// biome-ignore-all lint/suspicious/noConsole: CLI launcher — the console is the interface

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '../../../');
const MODEL_DIR = joinCwd('models', 'tts');
const KOKORO_DIR = join(MODEL_DIR, 'kokoro-multi-lang-v1_0');
const KOKORO_TARBALL_URL =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2';
// Port from packages/shared/constants development_ports.ts (C-390 AC-11).
const PORT = process.env.TTS_PORT ?? '8089';
// tts_server.py lives in the sibling docker/voice tree
const TTS_SERVER = join(ROOT, 'docker', 'voice', 'tts_server.py');

function joinCwd(...parts: string[]): string {
  return resolve(process.cwd(), ...parts);
}

function commandExists(name: string): boolean {
  try {
    Bun.which(name);
    return true;
  } catch {
    return false;
  }
}

// Verify Python + sherpa-onnx are available BEFORE downloading any model.
if (!commandExists('python3')) {
  console.error('❌ python3 is not installed on the host.');
  process.exit(1);
}

async function pythonHasSherpaOnnx(): Promise<boolean> {
  try {
    const res = Bun.spawnSync(['python3', '-c', 'import sherpa_onnx'], {
      stdout: 'ignore',
      stderr: 'ignore',
    });
    return res.exitCode === 0;
  } catch {
    return false;
  }
}

if (!(await pythonHasSherpaOnnx())) {
  console.error('❌ sherpa-onnx is not installed in the active Python environment.');
  console.error('   Install it with:  pip install sherpa-onnx');
  process.exit(1);
}

// Only skip the download when the complete model directory exists (model.onnx,
// voices.bin, tokens.txt, espeak-ng-data). Fetch to a temp location and move
// atomically so interrupted downloads never leave a partial model dir.
if (!existsSync(KOKORO_DIR)) {
  console.log(`Kokoro TTS model missing in ${MODEL_DIR}. Downloading...`);
  await mkdir(MODEL_DIR, { recursive: true });
  const tarball = join(MODEL_DIR, 'kokoro.tar.bz2');
  const res = await fetch(KOKORO_TARBALL_URL);
  if (!res.ok || !res.body) {
    console.error(`❌ Kokoro model download failed: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  await Bun.write(tarball, await res.arrayBuffer());
  await rm(join(MODEL_DIR, '.kokoro-tmp'), { recursive: true, force: true });
  await mkdir(join(MODEL_DIR, '.kokoro-tmp'), { recursive: true });
  Bun.spawnSync(['tar', 'xjf', tarball, '-C', join(MODEL_DIR, '.kokoro-tmp')], {
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  await rename(join(MODEL_DIR, '.kokoro-tmp', 'kokoro-multi-lang-v1_0'), KOKORO_DIR);
  await rm(join(MODEL_DIR, '.kokoro-tmp'), { recursive: true, force: true });
  await rm(tarball, { force: true });
}

console.log(`Starting native sherpa-onnx Kokoro TTS server on port ${PORT}...`);
const child = spawn('python3', [TTS_SERVER, PORT], { stdio: 'inherit' });
child.on('error', (error) => {
  console.error(`python3 failed to start: ${error.message}`);
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 0));
