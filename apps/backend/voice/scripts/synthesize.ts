// apps/backend/voice/scripts/synthesize.ts
/** biome-ignore-all lint/suspicious/noConsole: CLI script — console is the interface */
/** biome-ignore-all lint/style/useNamingConvention: sherpa-onnx API uses snake_case fields */
// Synthesize speech via the sherpa-onnx voice dev engine (C-392) and play
// with mpv.
//
// The default voice service is sherpa-onnx (Kokoro TTS) from the C-390
// local-stack compose profile. The endpoint shape is unchanged from the
// pre-C-392 kokoro-server container: POST :8089/v1/audio/speech. The
// readiness probe moved to GET /health (sherpa does not expose /v1/voices).
//
// Usage:
//   bun run test:speech                          # default "Hello world"
//   bun run test:speech "Welcome to Aikami"      # custom text
//   bun run test:speech "Hello" af_bella          # custom text + voice
//
// Environment overrides (documented alongside TTS_PORT):
//   TTS_HOST  — engine host (default localhost)
//   TTS_PORT  — engine port (default 8089)

const HOST = process.env.TTS_HOST ?? 'localhost';
const PORT = process.env.TTS_PORT ?? '8089';
const text = Bun.argv[2] ?? 'Hello world';
const voice = Bun.argv[3] ?? 'af_heart';
const outfile = '/tmp/aikami-voice-speech.wav';
const url = `http://${HOST}:${PORT}/v1/audio/speech`;

console.log(`🎙  Synthesizing: "${text}"`);
console.log(`   Voice: ${voice}`);
console.log(`   Endpoint: ${url}`);

// Preflight against the sherpa /health endpoint so a missing container is
// reported before the synthesis POST.
try {
  const health = await fetch(`http://${HOST}:${PORT}/health`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!health.ok) {
    console.error(
      `❌ sherpa-onnx /health returned ${health.status} — engine may still be booting.`,
    );
    process.exit(1);
  }
} catch {
  console.error('❌ Failed to reach sherpa-onnx /health. Is the container running?');
  console.error('   Start it: bun run herdr:start voice');
  process.exit(1);
}

const payload = JSON.stringify({
  model: 'tts-1',
  input: text,
  voice,
  response_format: 'wav',
});

try {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    console.error(`❌ sherpa-onnx returned ${response.status}: ${errText}`);
    process.exit(1);
  }

  const buffer = await response.arrayBuffer();
  await Bun.write(outfile, buffer);
  const size = buffer.byteLength;
  console.log(`✓ Saved ${outfile} (${size} bytes)`);

  // Try mpv, then ffplay, then aplay
  const players = ['mpv', 'ffplay', 'aplay'] as const;
  const available = players.find((p) => Bun.which(p) !== null);

  if (available) {
    let args: readonly string[];
    if (available === 'mpv') {
      args = ['--really-quiet', '--no-terminal', outfile];
    } else if (available === 'ffplay') {
      args = ['-nodisp', '-autoexit', '-loglevel', 'quiet', outfile];
    } else {
      args = ['-q', outfile];
    }

    console.log(`🔊 Playing with ${available}...`);
    await Bun.$`${available} ${args}`;
  } else {
    console.log(`⚠  No audio player found (tried mpv, ffplay, aplay). File saved at ${outfile}`);
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string }).code;

  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || message.includes('fetch')) {
    console.error('❌ Failed to connect to sherpa-onnx. Is the container running?');
    console.error('   Start it: bun run herdr:start voice');
    process.exit(1);
  }

  console.error('❌', message);
  process.exit(1);
}
