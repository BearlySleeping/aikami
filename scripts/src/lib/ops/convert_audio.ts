#!/usr/bin/env bun
// scripts/src/lib/ops/convert_audio.ts
//
// Converts sample audio from the Godot asset directory to the formats
// required by C-150 (Audio System):
//   BGM: .ogg (Vorbis) → .webm (Opus, 48kHz stereo)
//   SFX: .wav/.ogg/.mp3 → .wav (PCM S16LE, 44.1kHz mono)
//
// Usage: bun run scripts/src/lib/ops/convert_audio.ts

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';

const SOURCE_MUSIC = 'examples/aikami-v1-godot/assets/audio/music';
const SOURCE_SFX = 'examples/aikami-v1-godot/assets/audio/sfx';
const TARGET_MUSIC = 'apps/frontend/client/static/assets/audio/music';
const TARGET_SFX = 'apps/frontend/client/static/assets/audio/sfx';

// ── Mapping: target filename → source file ──────────────────────────────

const BGM_MAP: Record<string, string> = {
  'bgm_explore.webm': join(SOURCE_MUSIC, 'dawn.ogg'),
  'bgm_combat.webm': join(SOURCE_MUSIC, 'guts.ogg'),
};

const SFX_MAP: Record<string, string> = {
  'sfx_hit.wav': join(SOURCE_SFX, 'hit_player.wav'),
  'sfx_pickup.wav': join(SOURCE_SFX, 'item_pickup.wav'),
};

// ── Helpers ──────────────────────────────────────────────────────────────

const run = (command: string): void => {
  console.log(`  $ ${command}`);
  execSync(command, { stdio: 'inherit' });
};

const convertToWebmOpus = (source: string, target: string): void => {
  console.log(`\n🎵 Converting BGM: ${basename(source)} → ${basename(target)}`);
  if (!existsSync(source)) {
    console.error(`  ❌ Source not found: ${source}`);
    return;
  }
  run(`ffmpeg -y -i "${source}" -c:a libopus -b:a 128k -ar 48000 -ac 2 "${target}"`);
  console.log(`  ✅ ${basename(target)} (Opus 128kbps, 48kHz stereo)`);
};

const convertToWav = (source: string, target: string): void => {
  console.log(`\n💥 Converting SFX: ${basename(source)} → ${basename(target)}`);
  if (!existsSync(source)) {
    console.error(`  ❌ Source not found: ${source}`);
    return;
  }
  run(`ffmpeg -y -i "${source}" -c:a pcm_s16le -ar 44100 -ac 1 "${target}"`);
  console.log(`  ✅ ${basename(target)} (PCM S16LE, 44.1kHz mono)`);
};

// ── Main ─────────────────────────────────────────────────────────────────

console.log('🎧 Aikami Audio Converter — C-150');
console.log(`   Music: ${TARGET_MUSIC}`);
console.log(`   SFX:   ${TARGET_SFX}\n`);

mkdirSync(TARGET_MUSIC, { recursive: true });
mkdirSync(TARGET_SFX, { recursive: true });

// Convert BGM tracks → music/
for (const [targetFile, sourceFile] of Object.entries(BGM_MAP)) {
  convertToWebmOpus(sourceFile, join(TARGET_MUSIC, targetFile));
}

// Convert SFX tracks → sfx/
for (const [targetFile, sourceFile] of Object.entries(SFX_MAP)) {
  convertToWav(sourceFile, join(TARGET_SFX, targetFile));
}

// ── Verify ───────────────────────────────────────────────────────────────

console.log('\n📋 Music:');
for (const file of Object.keys(BGM_MAP)) {
  const path = join(TARGET_MUSIC, file);
  if (existsSync(path)) {
    const { size } = Bun.file(path);
    console.log(`  ${(size / 1024).toFixed(1).padStart(8)} KB  music/${file}`);
  }
}

console.log('\n📋 SFX:');
for (const file of Object.keys(SFX_MAP)) {
  const path = join(TARGET_SFX, file);
  if (existsSync(path)) {
    const { size } = Bun.file(path);
    console.log(`  ${(size / 1024).toFixed(1).padStart(8)} KB  sfx/${file}`);
  }
}

console.log('\n✨ Done. Audio assets ready for testing at /dev/audio');
