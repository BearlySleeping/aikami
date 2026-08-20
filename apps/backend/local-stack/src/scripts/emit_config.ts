// apps/backend/local-stack/src/scripts/emit_config.ts
//
// Emits the runtime engine config.json for the staged client build (C-389).
// Replaces the old build-time PUBLIC_* endpoint baking: the SPA bundle is now
// topology-agnostic, and each deployment path writes the config file it needs.
// Was scripts/emit_config.sh — emits to stdout so `> config.json` works.
//
// Defaults follow the C-390 allocation table (development_ports.ts):
// text 11434, image 8188, voice 8089, stt 8087. Override with
// LLM_ENDPOINT / IMAGE_ENDPOINT / VOICE_ENDPOINT / STT_ENDPOINT.

import process from 'node:process';

const env = (key: string, fallback: string): string => process.env[key] ?? fallback;

const LLM = env('LLM_ENDPOINT', 'http://localhost:11434/v1');
const IMAGE = env('IMAGE_ENDPOINT', 'http://localhost:8188');
const VOICE = env('VOICE_ENDPOINT', 'http://localhost:8089');
const STT = env('STT_ENDPOINT', 'http://localhost:8087');

const voice = VOICE !== '' ? { mode: 'server', url: VOICE } : { mode: 'browser', url: null };
const sttUrl = STT !== '' ? STT : null;

const config = {
  text: { url: LLM, model: 'qwen3-4b-instruct' },
  image: { url: IMAGE, engine: 'auto' },
  voice: {
    tts: { mode: voice.mode, url: voice.url },
    stt: { url: sttUrl },
  },
  models: { originUrl: 'https://huggingface.co' },
};

process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
