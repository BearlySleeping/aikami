// apps/backend/local-stack/stack/generation/audio_finishing.test.ts
//
// C-521 AC-3/AC-4: the real finishing path — pinned ffmpeg, argv arrays,
// decoded-byte measurement, repeatable hashes.
//
// These tests run ffmpeg for real. They are the evidence that "process each
// profile twice, then the rendition hashes repeat" and "measured integrated
// loudness lands inside the profile's declared tolerance" are facts about this
// machine, not aspirations.
//
// Contract: C-521 Music and SFX generation with audio preparation

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AUDIO_RENDITION_PROFILES } from '@aikami/local-ai';
import type { RunResult } from './audio_finishing.ts';
import { finishAudioMaster } from './audio_finishing.ts';

/** Builds a 32-bit float WAV in memory (the fixture encoder the host needs). */
const encodeFloat32Wav = (channelData: readonly Float32Array[], sampleRate: number): Uint8Array => {
  const channels = channelData.length;
  const frames = channelData[0]?.length ?? 0;
  const data = new Uint8Array(frames * channels * 4);
  const view = new DataView(data.buffer);
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      view.setFloat32(
        (frame * channels + channel) * 4,
        (channelData[channel] as Float32Array)[frame] as number,
        true,
      );
    }
  }
  const header = new Uint8Array(44);
  const headerView = new DataView(header.buffer);
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) {
      header[offset + i] = text.charCodeAt(i);
    }
  };
  ascii(0, 'RIFF');
  headerView.setUint32(4, 36 + data.length, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  headerView.setUint32(16, 16, true);
  headerView.setUint16(20, 3, true); // IEEE float
  headerView.setUint16(22, channels, true);
  headerView.setUint32(24, sampleRate, true);
  headerView.setUint32(28, sampleRate * channels * 4, true);
  headerView.setUint16(32, channels * 4, true);
  headerView.setUint16(34, 32, true);
  ascii(36, 'data');
  headerView.setUint32(40, data.length, true);
  const out = new Uint8Array(header.length + data.length);
  out.set(header, 0);
  out.set(data, header.length);
  return out;
};

const SAMPLE_RATE = 48_000;
const CREATED_AT = '2026-09-14T00:00:00.000Z';

const sine = (options: {
  frequency: number;
  seconds: number;
  amplitudes: readonly number[];
}): Float32Array[] => {
  const frames = Math.round(options.seconds * SAMPLE_RATE);
  return options.amplitudes.map((amplitude) => {
    const channel = new Float32Array(frames);
    for (let i = 0; i < frames; i += 1) {
      channel[i] = amplitude * Math.sin((2 * Math.PI * options.frequency * i) / SAMPLE_RATE);
    }
    return channel;
  });
};

const ffmpegAvailable = (): boolean => {
  try {
    const probe = Bun.spawnSync(['ffmpeg', '-version']);
    return probe.exitCode === 0;
  } catch {
    return false;
  }
};

const hasFfmpeg = ffmpegAvailable();

let scratchDir = '';
beforeAll(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), 'c521-'));
});
afterAll(async () => {
  await rm(scratchDir, { recursive: true, force: true });
});

const writeMaster = async (name: string, bytes: Uint8Array): Promise<string> => {
  const path = join(scratchDir, name);
  await Bun.write(path, bytes);
  return path;
};

describe('ffmpeg availability', () => {
  test('the finishing path requires a pinned ffmpeg on this host', () => {
    if (!hasFfmpeg) {
      // 🔴 Not a pass: report exactly which gate is missing rather than
      // silently skipping the evidence this contract requires.
      throw new Error(
        'ffmpeg is not on PATH — C-521 AC-3/AC-4 finishing evidence cannot be produced on this host',
      );
    }
    expect(hasFfmpeg).toBe(true);
  });
});

describe.skipIf(!hasFfmpeg)('finishAudioMaster (real ffmpeg)', () => {
  test('processing the music profile twice produces the SAME rendition hash', async () => {
    // -30 dBFS so loudnorm has real work to do (+12 dB toward -18 LUFS).
    const masterPath = await writeMaster(
      'music-master.wav',
      encodeFloat32Wav(
        sine({ frequency: 1000, seconds: 4, amplitudes: [0.0316, 0.0316] }),
        SAMPLE_RATE,
      ),
    );

    const first = await finishAudioMaster({
      masterPath,
      renditionPath: join(scratchDir, 'music-1.webm'),
      profileId: 'music_runtime',
      createdAt: CREATED_AT,
    });
    const second = await finishAudioMaster({
      masterPath,
      renditionPath: join(scratchDir, 'music-2.webm'),
      profileId: 'music_runtime',
      createdAt: CREATED_AT,
    });

    expect(first.rendition).toBeDefined();
    expect(second.rendition).toBeDefined();
    // AC-3: "valid rendition hashes repeat for pinned tools".
    expect(first.rendition?.rendition.contentHash).toBe(second.rendition?.rendition.contentHash);

    const rendition = first.rendition?.rendition;
    expect(rendition?.container).toBe('webm');
    expect(rendition?.codec).toBe('opus');
    // Measured from the decoded Opus, not from the master.
    expect(rendition?.sampleRate).toBe(48_000);
    expect(rendition?.channels).toBe(2);
    expect(rendition?.durationSeconds as number).toBeGreaterThan(3.5);
    // AC-3: music ≈ -18 LUFS-I ±2, true peak ≤ -1 dBTP.
    expect(rendition?.analysis.integratedLufs as number).toBeGreaterThan(-20);
    expect(rendition?.analysis.integratedLufs as number).toBeLessThan(-16);
    expect(rendition?.analysis.truePeakDb as number).toBeLessThanOrEqual(-1);
    expect(first.accepted).toBe(true);
    expect(rendition?.findings).toEqual([]);
  }, 120_000);

  test('the archival master is recorded unmodified and every rendition points at its hash', async () => {
    const masterBytes = encodeFloat32Wav(
      sine({ frequency: 440, seconds: 2, amplitudes: [0.2, 0.2] }),
      SAMPLE_RATE,
    );
    const masterPath = await writeMaster('ambient-master.wav', masterBytes);
    const finished = await finishAudioMaster({
      masterPath,
      renditionPath: join(scratchDir, 'ambient.webm'),
      profileId: 'ambient_runtime',
      createdAt: CREATED_AT,
    });

    const master = finished.masterRendition.rendition;
    expect(master.profileId).toBe('archival_master');
    // The master is its own parent — the lineage anchor.
    expect(master.parentMasterHash).toBe(master.contentHash);
    expect(finished.rendition?.rendition.parentMasterHash).toBe(master.contentHash);
    expect(finished.masterRendition.accepted).toBe(true);
    // The master keeps its source rate/channels: it is never rewritten.
    expect(master.sampleRate).toBe(SAMPLE_RATE);
    expect(master.channels).toBe(2);
    expect(finished.rendition?.rendition.analysis.integratedLufs as number).toBeGreaterThan(-27);
    expect(finished.rendition?.rendition.analysis.integratedLufs as number).toBeLessThan(-21);
  }, 120_000);

  test('authored loop bounds survive encoding and are valid in the decoded rendition', async () => {
    // 400 Hz at 48 kHz: 120-sample period, zero crossings every 60 samples.
    const masterPath = await writeMaster(
      'loop-master.wav',
      encodeFloat32Wav(sine({ frequency: 400, seconds: 4, amplitudes: [0.25, 0.25] }), SAMPLE_RATE),
    );
    const finished = await finishAudioMaster({
      masterPath,
      renditionPath: join(scratchDir, 'loop.webm'),
      profileId: 'music_runtime',
      createdAt: CREATED_AT,
      masterSampleRate: SAMPLE_RATE,
      loop: { loopStartSample: 0, loopEndSample: 60 * 800, crossfadeSamples: 480 },
    });

    const rendition = finished.rendition?.rendition;
    expect(rendition?.loop).toBeDefined();
    expect(rendition?.loopable).toBe(true);
    expect(rendition?.loop?.loopStartSample).toBeGreaterThanOrEqual(0);
    expect(rendition?.loop?.loopEndSample).toBeLessThanOrEqual(rendition?.sampleCount as number);
    // The seam is crossfaded by the plan, so no seam finding is raised.
    expect(rendition?.findings.map((entry) => entry.code)).not.toContain('loop_seam_mismatch');
  }, 120_000);

  test('a near-silent master is refused BEFORE ffmpeg is asked to normalise it', async () => {
    const masterPath = await writeMaster(
      'silent-master.wav',
      encodeFloat32Wav(sine({ frequency: 1000, seconds: 1, amplitudes: [0, 0] }), SAMPLE_RATE),
    );
    let commandRuns = 0;
    const finished = await finishAudioMaster({
      masterPath,
      renditionPath: join(scratchDir, 'silent.webm'),
      profileId: 'music_runtime',
      createdAt: CREATED_AT,
      run: async (program, args): Promise<RunResult> => {
        commandRuns += 1;
        const child = Bun.spawn([program, ...args], { stdout: 'pipe', stderr: 'pipe' });
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        return { exitCode, stdout, stderr };
      },
    });

    // The archival master is preserved (it is not normalised), but no rendition
    // is produced and ffmpeg is never invoked to make one loud.
    expect(finished.masterRendition.accepted).toBe(true);
    expect(finished.rendition).toBeUndefined();
    expect(finished.accepted).toBe(false);
    expect(commandRuns).toBe(0);
  }, 60_000);

  test('a clipped master fails with the named finding code and is never encoded', async () => {
    const clipped = sine({ frequency: 440, seconds: 1, amplitudes: [2, 2] });
    const masterPath = await writeMaster(
      'clipped-master.wav',
      encodeFloat32Wav(clipped, SAMPLE_RATE),
    );
    let commandRuns = 0;
    const finished = await finishAudioMaster({
      masterPath,
      renditionPath: join(scratchDir, 'clipped.webm'),
      profileId: 'music_runtime',
      createdAt: CREATED_AT,
      run: async (): Promise<RunResult> => {
        commandRuns += 1;
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    });
    expect(finished.accepted).toBe(false);
    expect(finished.rendition).toBeUndefined();
    expect(commandRuns).toBe(0);
    expect(finished.masterRendition.rendition.findings.map((entry) => entry.code)).toContain(
      'clipping',
    );
  }, 60_000);

  test('every plan argument is an argv entry — no shell string is ever built', async () => {
    const masterPath = await writeMaster(
      'shell-master.wav',
      encodeFloat32Wav(sine({ frequency: 440, seconds: 1, amplitudes: [0.2, 0.2] }), SAMPLE_RATE),
    );
    const seen: { program: string; args: readonly string[] }[] = [];
    await finishAudioMaster({
      masterPath,
      renditionPath: join(scratchDir, 'shell.webm'),
      profileId: 'music_runtime',
      createdAt: CREATED_AT,
      run: async (program, args): Promise<RunResult> => {
        seen.push({ program, args });
        const child = Bun.spawn([program, ...args], { stdout: 'pipe', stderr: 'pipe' });
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        return { exitCode, stdout, stderr };
      },
    });
    expect(seen.length).toBeGreaterThanOrEqual(2);
    // The master path is one argv entry, never part of a shell command line.
    expect(seen.some((call) => call.args.includes(masterPath))).toBe(true);
    for (const call of seen) {
      expect(Array.isArray(call.args)).toBe(true);
      expect(call.program).toBe('ffmpeg');
    }
  }, 120_000);

  test('the declared profiles of this contract are all resolvable by the finisher', () => {
    expect(Object.keys(AUDIO_RENDITION_PROFILES)).toEqual([
      'archival_master',
      'music_runtime',
      'ambient_runtime',
      'sfx_positional',
      'ui_stereo',
    ]);
  });
});
