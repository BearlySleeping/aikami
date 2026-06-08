// apps/backend/voice/scripts/synthesize.ts
// Synthesize speech via the Kokoro TTS container and play with mpv.
//
// Usage:
//   bun run test:speech                          # default "Hello world"
//   bun run test:speech "Welcome to Aikami"      # custom text
//   bun run test:speech "Hello" af_bella          # custom text + voice

const HOST = process.env.KOKORO_HOST ?? 'localhost';
const PORT = process.env.KOKORO_PORT ?? '8089';
const text = Bun.argv[2] ?? 'Hello world';
const voice = Bun.argv[3] ?? 'af_heart';
const outfile = '/tmp/aikami-voice-speech.wav';
const url = `http://${HOST}:${PORT}/v1/audio/speech`;

console.log(`🎙  Synthesizing: "${text}"`);
console.log(`   Voice: ${voice}`);
console.log(`   Endpoint: ${url}`);

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
    console.error(`❌ Kokoro returned ${response.status}: ${errText}`);
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
    const args =
      available === 'mpv'
        ? ['--really-quiet', '--no-terminal', outfile]
        : available === 'ffplay'
          ? ['-nodisp', '-autoexit', '-loglevel', 'quiet', outfile]
          : ['-q', outfile];

    console.log(`🔊 Playing with ${available}...`);
    await Bun.$`${available} ${args}`;
  } else {
    console.log(
      `⚠  No audio player found (tried mpv, ffplay, aplay). File saved at ${outfile}`,
    );
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string }).code;

  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || message.includes('fetch')) {
    console.error('❌ Failed to connect to Kokoro. Is the container running?');
    console.error('   Start it: bun run tmux:start voice');
    process.exit(1);
  }

  console.error('❌', message);
  process.exit(1);
}
