// apps/backend/local-stack/src/scripts/native/run_stt.ts
//
// Native host launcher for local speech-to-text (STT) without Docker — the
// macOS path (Docker Desktop has no Metal passthrough; this is a
// latency-sensitive service, C-393 AC-12). Was bin/run-native-stt.sh.
//
// Starts the SAME service the container runs, on the same port and protocol:
//   - python3 docker/voice/stt_server.py on $STT_PORT (8087) — the C-393
//     streaming websocket (WS /v1/stream, Moonshine + Silero VAD), plus
//     GET /v1/capabilities, GET /health, and the OpenAI-compatible batch
//     proxy.
//   - whisper-server (whisper.cpp) on the internal WHISPER_PORT when the
//     binary is present — batch transcription (POST /v1/audio/transcriptions).
//
// Models live in ./models/stt and are provisioned by the model fetcher — this
// script never downloads them; it verifies the files exist and exits with a
// fetch hint when a model is missing.
//
// biome-ignore-all lint/suspicious/noConsole: CLI launcher — the console is the interface

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '../../../');
const MODELS_DIR = joinCwd('models');

// Ports from packages/shared/constants development_ports.ts (C-390 AC-11).
const PORT = process.env.STT_PORT ?? '8087';
// Export so stt_server.py's batch proxy reads the SAME internal port the
// whisper-server was launched on (it defaults to 8091 on its own).
const WHISPER_PORT = process.env.WHISPER_PORT ?? '8091';
const BIND = process.env.STT_BIND_ADDRESS ?? '127.0.0.1';

// C-393 model selection (manifest targetPaths, mirror the container defaults).
const STT_STREAM_MODEL = process.env.STT_STREAM_MODEL ?? 'stt/sherpa-onnx-moonshine-tiny-en-int8';
const STT_BATCH_MODEL = process.env.STT_BATCH_MODEL ?? 'stt/whisper-tiny/ggml-tiny.bin';
const STT_VAD_MODEL = process.env.STT_VAD_MODEL ?? 'stt/silero_vad.onnx';

const STREAM_DIR = join(MODELS_DIR, STT_STREAM_MODEL);
const BATCH_FILE = join(MODELS_DIR, STT_BATCH_MODEL);
const VAD_FILE = join(MODELS_DIR, STT_VAD_MODEL);

// Mirror the original script's model-dir discovery. The launcher can be
// invoked from the stack root; keep relative to the working directory.
function joinCwd(...parts: string[]): string {
  return resolve(process.cwd(), ...parts);
}

// Verify the streaming model files exist BEFORE fetching anything the server
// cannot run — the service must not claim readiness without its model.
if (!existsSync(STREAM_DIR) || !existsSync(join(STREAM_DIR, 'encode.int8.onnx'))) {
  console.error(`❌ Moonshine STT model missing in ${MODELS_DIR}/${STT_STREAM_MODEL}.`);
  console.error(
    '   Run the model fetcher:  bun src/lib/fetch_models.ts --entry stt-moonshine-tiny-en-int8 --entry stt-whisper-tiny',
  );
  console.error('   (or download the tarball from the k2-fsa sherpa-onnx releases and');
  console.error(`   extract it to ${STREAM_DIR})`);
  process.exit(1);
}
if (!existsSync(VAD_FILE)) {
  console.error(`❌ Silero VAD model missing at ${VAD_FILE} — fetch it with the model fetcher.`);
  process.exit(1);
}

// Export the model paths for stt_server.py (it resolves defaults itself, but
// the explicit exports keep this script the single source of truth).
process.env.MODELS_DIR = MODELS_DIR;
process.env.STT_STREAM_MODEL = STT_STREAM_MODEL;
process.env.STT_BATCH_MODEL = STT_BATCH_MODEL;
process.env.STT_VAD_MODEL = STT_VAD_MODEL;
process.env.STT_BIND_ADDRESS = BIND;

// Batch engine (optional on the host): whisper-server must be installed
// separately; without it the service still streams and reports batch
// unavailable via /v1/capabilities.
let whisperPid: number | undefined;
let whisperLog: string | undefined;
const hasWhisper = Bun.which('whisper-server') !== null;

if (hasWhisper) {
  if (!existsSync(BATCH_FILE)) {
    console.warn(`⚠ whisper batch model missing at ${BATCH_FILE} — batch will be unavailable`);
    console.warn('  (fetch it with: bun src/lib/fetch_models.ts --entry stt-whisper-tiny)');
  } else {
    console.log(`Starting whisper.cpp batch server on 127.0.0.1:${WHISPER_PORT} ...`);
    whisperLog = resolve(process.env.TMPDIR ?? '/tmp', `whisper-server.${Date.now()}.log`);
    const whisper = spawn(
      'whisper-server',
      [
        '--host',
        '127.0.0.1',
        '--port',
        WHISPER_PORT,
        '--model',
        BATCH_FILE,
        '--threads',
        process.env.STT_WHISPER_THREADS ?? '4',
        '--no-gpu',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    whisperPid = whisper.pid;
    // Stream the whisper log so failures are visible.
    whisper.stdout?.on('data', (d) => process.stdout.write(d));
    whisper.stderr?.on('data', (d) => process.stderr.write(d));
  }
} else {
  console.warn(
    '⚠ whisper-server not found on the host — batch endpoint unavailable (streaming still works)',
  );
}

// Keep the background whisper-server alive while stt_server.py runs and
// clean it up when the script exits.
const cleanup = (): void => {
  if (whisperPid !== undefined) {
    try {
      process.kill(whisperPid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
  if (whisperLog) {
    unlink(whisperLog).catch(() => {});
  }
};
process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

console.log(`Starting native STT server on ${BIND}:${PORT} ...`);
const sttServer = join(ROOT, 'docker', 'voice', 'stt_server.py');
const child = spawn('python3', [sttServer, PORT], { stdio: 'inherit' });
child.on('error', (error) => {
  console.error(`python3 failed to start: ${error.message}`);
  cleanup();
  process.exit(1);
});
child.on('exit', (code) => {
  cleanup();
  process.exit(code ?? 0);
});
