// apps/backend/local-stack/src/scripts/native/run_llm.ts
//
// Native host launcher for the local LLM (OpenAI-compatible) without Docker
// (was bin/run-native-llm.sh).
//
// Tries in order:
//   1. shimmy   — llama.cpp wrapper with an OpenAI-compatible API
//                (container-only distribution; see the compose stack instead)
//   2. llama-server — llama.cpp's native server (OpenAI-compatible /v1 API)
//
// First run downloads a default GGUF model (Qwen3 0.6B instruct) into
// models/llm/. Override with LLM_MODEL_URL / LLM_MODEL_FILE / LLM_PORT /
// LLM_HOST.
//
// biome-ignore-all lint/suspicious/noConsole: CLI launcher — the console is the interface

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const MODEL_DIR = join(process.cwd(), 'models', 'llm');
// Port from packages/shared/constants development_ports.ts (C-390 AC-11).
const PORT = process.env.LLM_PORT ?? '11434';
// Bind to loopback by default; set LLM_HOST=0.0.0.0 to expose on the network.
const HOST = process.env.LLM_HOST ?? '127.0.0.1';

const LLM_MODEL_URL =
  process.env.LLM_MODEL_URL ??
  'https://huggingface.co/Qwen/Qwen3-0.6B-Instruct-GGUF/resolve/main/qwen3-0.6b-instruct-q4_k_m.gguf';
const LLM_MODEL_FILE = process.env.LLM_MODEL_FILE ?? 'qwen3-0.6b-instruct-q4_k_m.gguf';
const MODEL_PATH = join(MODEL_DIR, LLM_MODEL_FILE);

const commandExists = (name: string): boolean => {
  try {
    Bun.which(name);
    return true;
  } catch {
    return false;
  }
};

async function download(url: string, dest: string): Promise<void> {
  await mkdir(dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`download failed: ${res.status} ${res.statusText}`);
  }
  await Bun.write(`${dest}.tmp`, await res.arrayBuffer());
  await rename(`${dest}.tmp`, dest);
}

// Validate that a server binary exists BEFORE downloading any model.
let engine: 'shimmy' | 'llama-server' | undefined;
if (commandExists('shimmy')) {
  engine = 'shimmy';
} else if (commandExists('llama-server')) {
  engine = 'llama-server';
}

if (engine === undefined) {
  console.error("❌ Neither 'shimmy' nor 'llama-server' is installed on the host.");
  console.error('   - llama.cpp: https://github.com/ggml-org/llama.cpp (build llama-server)');
  console.error('   - shimmy (container): ghcr.io/michael-a-kuykendall/shimmy:latest');
  process.exit(1);
}

if (!existsSync(MODEL_PATH)) {
  console.log(`LLM GGUF model missing in ${MODEL_DIR}. Downloading...`);
  // Download to a temp file and move atomically so interrupted downloads
  // never leave a truncated model that later starts would trust.
  await download(LLM_MODEL_URL, MODEL_PATH);
}

if (engine === 'shimmy') {
  console.log(`Starting shimmy (OpenAI-compatible) on ${HOST}:${PORT}...`);
  const child = spawn('shimmy', ['serve', '--model', MODEL_PATH, '--port', PORT, '--host', HOST], {
    stdio: 'inherit',
  });
  child.on('error', (error) => {
    console.error(`shimmy failed to start: ${error.message}`);
    process.exit(1);
  });
  child.on('exit', (code) => process.exit(code ?? 0));
} else {
  console.log(`Starting llama-server (OpenAI-compatible) on ${HOST}:${PORT}...`);
  const child = spawn('llama-server', ['-m', MODEL_PATH, '--port', PORT, '--host', HOST], {
    stdio: 'inherit',
  });
  child.on('error', (error) => {
    console.error(`llama-server failed to start: ${error.message}`);
    process.exit(1);
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}
