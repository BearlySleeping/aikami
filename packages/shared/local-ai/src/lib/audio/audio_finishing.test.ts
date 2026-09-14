// packages/shared/local-ai/src/lib/audio/audio_finishing.test.ts
//
// C-521 AC-3/AC-4: finishing is reproducible, measured from decoded bytes,
// refuses near-silent masters, and validates loop bounds.
//
// Contract: C-521 Music and SFX generation with audio preparation

import { describe, expect, test } from 'bun:test';
import {
  clippedSignal,
  dcOffsetSignal,
  encodeFloat32Wav,
  encodePcm16Wav,
  nonfiniteSignal,
  silentChannels,
  sineWave,
} from '../__fixtures__/audio_bytes.ts';
import { analyseDecodedAudio } from './audio_analysis.ts';
import {
  alignLoopBoundsToRendition,
  assertSafeFfmpegPath,
  buildAudioRendition,
  buildFfmpegRenditionPlan,
  checkLoopSeam,
  computeRmsNormalisationGain,
  validateLoopBounds,
} from './audio_finishing.ts';
import {
  AUDIO_RENDITION_PROFILES,
  verifyRenditionAgainstProfile,
} from './audio_rendition_profiles.ts';
import { decodeWav } from './wav_decode.ts';

const SAMPLE_RATE = 48_000;
const CREATED_AT = '2026-09-14T00:00:00.000Z';

const masterBytes = (options: {
  frequency: number;
  seconds: number;
  amplitudes: readonly number[];
}): Uint8Array =>
  encodeFloat32Wav({
    channelData: sineWave({ ...options, sampleRate: SAMPLE_RATE }),
    sampleRate: SAMPLE_RATE,
  });

const analyse = (bytes: Uint8Array) => {
  const decoded = decodeWav(bytes);
  return { decoded, ...analyseDecodedAudio(decoded) };
};

const codes = (findings: readonly { code: string }[]): string[] =>
  findings.map((entry) => entry.code).sort();

describe('analysis findings (decoded bytes, not headers)', () => {
  test('a clean master raises no finding', () => {
    const { findings } = analyse(
      masterBytes({ frequency: 440, seconds: 1, amplitudes: [0.5, 0.5] }),
    );
    expect(findings).toEqual([]);
  });

  test('a clipped master is an error with the named code', () => {
    const bytes = encodeFloat32Wav({
      channelData: clippedSignal({ channels: 1, sampleRate: SAMPLE_RATE, seconds: 0.5 }),
      sampleRate: SAMPLE_RATE,
    });
    const { analysis, findings } = analyse(bytes);
    expect(codes(findings)).toContain('clipping');
    expect(findings.find((entry) => entry.code === 'clipping')?.severity).toBe('error');
    expect(analysis.clippedSampleCount).toBeGreaterThan(0);
  });

  test('a master with NaN/Infinity samples is an error with the named code', () => {
    const bytes = encodeFloat32Wav({
      channelData: nonfiniteSignal({ channels: 1, sampleRate: SAMPLE_RATE, seconds: 0.5 }),
      sampleRate: SAMPLE_RATE,
    });
    const { analysis, findings } = analyse(bytes);
    expect(codes(findings)).toContain('nonfinite_samples');
    expect(analysis.nonfiniteSampleCount).toBe(3);
  });

  test('a DC-offset master is an error with the named code', () => {
    const bytes = encodeFloat32Wav({
      channelData: dcOffsetSignal({
        channels: 1,
        sampleRate: SAMPLE_RATE,
        seconds: 0.5,
        offset: 0.25,
      }),
      sampleRate: SAMPLE_RATE,
    });
    const { analysis, findings } = analyse(bytes);
    expect(codes(findings)).toContain('dc_offset');
    expect(analysis.dcOffset).toBeCloseTo(0.25, 3);
  });

  test('a mostly-silent clip raises excessive_silence as a warning', () => {
    const bytes = encodeFloat32Wav({
      channelData: silentChannels({ channels: 1, sampleRate: SAMPLE_RATE, seconds: 0.5 }),
      sampleRate: SAMPLE_RATE,
    });
    const { analysis, findings } = analyse(bytes);
    expect(codes(findings)).toContain('excessive_silence');
    expect(findings.find((entry) => entry.code === 'excessive_silence')?.severity).toBe('warning');
    expect(analysis.silenceRatio).toBe(1);
  });

  test('a truncated master reports truncation from the bytes', () => {
    const full = encodePcm16Wav({
      channelData: sineWave({
        frequency: 440,
        sampleRate: SAMPLE_RATE,
        seconds: 0.5,
        amplitudes: [0.5],
      }),
      sampleRate: SAMPLE_RATE,
    });
    const { decoded, findings } = analyse(full.slice(0, full.length - 1_000));
    expect(codes(findings)).toContain('truncated_clip');
    expect(decoded.durationSeconds).toBeGreaterThan(0);
  });
});

describe('buildAudioRendition', () => {
  test('a clean master produces an accepted, self-parented archival rendition', async () => {
    const bytes = masterBytes({ frequency: 440, seconds: 1, amplitudes: [0.5, 0.5] });
    const built = await buildAudioRendition({
      encoded: bytes,
      decodedWav: bytes,
      profileId: 'archival_master',
      container: 'wav',
      codec: 'pcm_f32le',
      mimeType: 'audio/wav',
      extension: '.wav',
      parentMasterHash: '',
      createdAt: CREATED_AT,
    });
    expect(built.accepted).toBe(true);
    expect(built.rendition.findings).toEqual([]);
    expect(built.rendition.contentHash).toHaveLength(64);
    expect(built.rendition.sampleRate).toBe(SAMPLE_RATE);
    expect(built.rendition.channels).toBe(2);
    expect(built.rendition.durationSeconds).toBeCloseTo(1, 3);
  });

  test('the same master and profile produce the same hash twice (AC-3 reproducibility)', async () => {
    const bytes = masterBytes({ frequency: 440, seconds: 1, amplitudes: [0.5, 0.5] });
    const build = () =>
      buildAudioRendition({
        encoded: bytes,
        decodedWav: bytes,
        profileId: 'archival_master',
        container: 'wav',
        codec: 'pcm_f32le',
        mimeType: 'audio/wav',
        extension: '.wav',
        parentMasterHash: '',
        createdAt: CREATED_AT,
      });
    const [first, second] = await Promise.all([build(), build()]);
    expect(first.rendition.contentHash).toBe(second.rendition.contentHash);
    expect(first.rendition).toEqual(second.rendition);
  });

  test('different masters hash differently', async () => {
    const a = masterBytes({ frequency: 440, seconds: 1, amplitudes: [0.5] });
    const b = masterBytes({ frequency: 441, seconds: 1, amplitudes: [0.5] });
    const build = (bytes: Uint8Array) =>
      buildAudioRendition({
        encoded: bytes,
        decodedWav: bytes,
        profileId: 'archival_master',
        container: 'wav',
        codec: 'pcm_f32le',
        mimeType: 'audio/wav',
        extension: '.wav',
        parentMasterHash: '',
        createdAt: CREATED_AT,
      });
    const [ra, rb] = await Promise.all([build(a), build(b)]);
    expect(ra.rendition.contentHash).not.toBe(rb.rendition.contentHash);
  });

  test('a near-silent master is refused for a normalised profile, never normalised into a loud effect', async () => {
    const silent = encodeFloat32Wav({
      channelData: silentChannels({ channels: 2, sampleRate: SAMPLE_RATE, seconds: 1 }),
      sampleRate: SAMPLE_RATE,
    });
    const { analysis: masterAnalysis } = analyse(silent);
    // The archival master is preserved verbatim and is allowed to be quiet.
    const archived = await buildAudioRendition({
      encoded: silent,
      decodedWav: silent,
      profileId: 'archival_master',
      container: 'wav',
      codec: 'pcm_f32le',
      mimeType: 'audio/wav',
      extension: '.wav',
      parentMasterHash: '',
      createdAt: CREATED_AT,
      masterAnalysis,
    });
    expect(archived.accepted).toBe(true);

    const runtime = await buildAudioRendition({
      encoded: silent,
      decodedWav: silent,
      profileId: 'music_runtime',
      container: 'webm',
      codec: 'opus',
      mimeType: 'audio/webm',
      extension: '.webm',
      parentMasterHash: archived.rendition.contentHash,
      createdAt: CREATED_AT,
      masterAnalysis,
    });
    expect(runtime.accepted).toBe(false);
    expect(codes(runtime.rendition.findings)).toContain('near_silent_master');
    expect(codes(runtime.rendition.findings)).toContain('loudness_out_of_tolerance');
    expect(runtime.rendition.parentMasterHash).toBe(archived.rendition.contentHash);
  });

  test('a ~-18 LUFS stereo master is accepted as the music runtime profile', async () => {
    const bytes = masterBytes({ frequency: 1000, seconds: 4, amplitudes: [0.126, 0.126] });
    const { analysis: masterAnalysis } = analyse(bytes);
    const built = await buildAudioRendition({
      encoded: new Uint8Array([1, 2, 3, 4]),
      decodedWav: bytes,
      profileId: 'music_runtime',
      container: 'webm',
      codec: 'opus',
      mimeType: 'audio/webm',
      extension: '.webm',
      parentMasterHash: 'a'.repeat(64),
      createdAt: CREATED_AT,
      masterAnalysis,
    });
    expect(built.rendition.analysis.integratedLufs as number).toBeCloseTo(-18, 0);
    expect(built.rendition.findings).toEqual([]);
    expect(built.accepted).toBe(true);
  });

  test('a loud master is rejected for the ambience profile with loudness_out_of_tolerance', async () => {
    const bytes = masterBytes({ frequency: 1000, seconds: 4, amplitudes: [0.126, 0.126] });
    const { analysis: masterAnalysis } = analyse(bytes);
    const built = await buildAudioRendition({
      encoded: new Uint8Array([1, 2, 3, 4]),
      decodedWav: bytes,
      profileId: 'ambient_runtime',
      container: 'webm',
      codec: 'opus',
      mimeType: 'audio/webm',
      extension: '.webm',
      parentMasterHash: 'a'.repeat(64),
      createdAt: CREATED_AT,
      masterAnalysis,
    });
    expect(built.accepted).toBe(false);
    const finding = built.rendition.findings.find(
      (entry) => entry.code === 'loudness_out_of_tolerance',
    );
    expect(finding).toBeDefined();
    expect(finding?.measured as number).toBeCloseTo(-18, 0);
    expect(finding?.limit as number).toBe(-24);
  });

  test('a one-shot profile rejects a stereo rendition with channel_count_out_of_bounds', async () => {
    const bytes = masterBytes({ frequency: 1000, seconds: 0.3, amplitudes: [0.5, 0.5] });
    const built = await buildAudioRendition({
      encoded: new Uint8Array([9, 9]),
      decodedWav: bytes,
      profileId: 'sfx_positional',
      container: 'wav',
      codec: 'pcm_s16le',
      mimeType: 'audio/wav',
      extension: '.wav',
      parentMasterHash: 'b'.repeat(64),
      createdAt: CREATED_AT,
    });
    expect(built.accepted).toBe(false);
    expect(codes(built.rendition.findings)).toContain('channel_count_out_of_bounds');
  });
});

describe('loop bounds', () => {
  test('accepts bounds that sit inside the decoded clip', () => {
    expect(
      validateLoopBounds({
        loop: { loopStartSample: 1_000, loopEndSample: 96_000 },
        sampleCount: 192_000,
        sampleRate: SAMPLE_RATE,
      }),
    ).toEqual([]);
  });

  test('rejects inverted and out-of-range bounds', () => {
    expect(
      codes(
        validateLoopBounds({
          loop: { loopStartSample: 5_000, loopEndSample: 1_000 },
          sampleCount: 192_000,
          sampleRate: SAMPLE_RATE,
        }),
      ),
    ).toContain('invalid_loop_bounds');
    expect(
      codes(
        validateLoopBounds({
          loop: { loopStartSample: 1_000, loopEndSample: 999_999 },
          sampleCount: 192_000,
          sampleRate: SAMPLE_RATE,
        }),
      ),
    ).toContain('invalid_loop_bounds');
  });

  test('a seam on a zero crossing passes; a mid-peak seam is flagged', () => {
    // 400 Hz at 48 kHz: one period every 120 samples, a zero crossing every 60.
    const channels = sineWave({
      frequency: 400,
      sampleRate: SAMPLE_RATE,
      seconds: 2,
      amplitudes: [0.5],
    });
    const clean = checkLoopSeam({
      channelData: channels,
      loop: { loopStartSample: 0, loopEndSample: 60 * 100 },
    });
    expect(clean).toEqual([]);

    const midPeak = checkLoopSeam({
      channelData: channels,
      loop: { loopStartSample: 0, loopEndSample: 60 * 100 + 30 },
    });
    expect(codes(midPeak)).toContain('loop_seam_mismatch');

    // A declared crossfade makes the raw seam step expected, not a finding.
    const crossfaded = checkLoopSeam({
      channelData: channels,
      loop: {
        loopStartSample: 0,
        loopEndSample: 60 * 100 + 30,
        crossfadeSamples: 240,
      },
    });
    expect(crossfaded).toEqual([]);
  });

  test('re-locates authored master bounds inside a rendition shifted by encoder delay', () => {
    const master = sineWave({
      frequency: 400,
      sampleRate: SAMPLE_RATE,
      seconds: 2,
      amplitudes: [0.5],
    });
    const delay = 7;
    const masterChannel = master[0] as Float32Array;
    const shifted = new Float32Array(masterChannel.length + delay);
    shifted.set(masterChannel, delay);

    const aligned = alignLoopBoundsToRendition({
      masterChannelData: master,
      renditionChannelData: [shifted],
      loop: { loopStartSample: 0, loopEndSample: 12_000 },
      searchRadiusSamples: 64,
    });
    expect(aligned).toBeDefined();
    expect(aligned?.loopStartSample).toBe(delay);
    expect(aligned?.loopEndSample).toBe(12_000 + delay);
  });

  test('returns undefined when the rendition does not contain the authored region', () => {
    const master = sineWave({
      frequency: 400,
      sampleRate: SAMPLE_RATE,
      seconds: 2,
      amplitudes: [0.5],
    });
    const noise = sineWave({
      frequency: 3_000,
      sampleRate: SAMPLE_RATE,
      seconds: 2,
      amplitudes: [0.9],
    });
    const aligned = alignLoopBoundsToRendition({
      masterChannelData: master,
      renditionChannelData: noise,
      loop: { loopStartSample: 0, loopEndSample: 12_000 },
      searchRadiusSamples: 64,
    });
    expect(aligned).toBeUndefined();
  });

  test('a loop on a one-shot profile is refused', async () => {
    const bytes = masterBytes({ frequency: 1000, seconds: 0.3, amplitudes: [0.5] });
    const built = await buildAudioRendition({
      encoded: new Uint8Array([9, 9]),
      decodedWav: bytes,
      profileId: 'sfx_positional',
      container: 'wav',
      codec: 'pcm_s16le',
      mimeType: 'audio/wav',
      extension: '.wav',
      parentMasterHash: 'b'.repeat(64),
      createdAt: CREATED_AT,
      loop: { loopStartSample: 0, loopEndSample: 10_000 },
    });
    expect(codes(built.rendition.findings)).toContain('invalid_loop_bounds');
    expect(built.rendition.loopable).toBe(false);
  });
});

describe('one-shot peak/RMS calibration', () => {
  test('clamps the gain so the true-peak ceiling wins', () => {
    const result = computeRmsNormalisationGain({
      analysis: { rmsDbfs: -30, truePeakDb: 0 },
      profile: AUDIO_RENDITION_PROFILES.sfx_positional,
    });
    expect(result.gainDb).toBeCloseTo(-1, 5);
    expect(codes(result.findings)).toContain('true_peak_exceeded');
  });

  test('a quiet one-shot with headroom gets the full target gain', () => {
    const result = computeRmsNormalisationGain({
      analysis: { rmsDbfs: -32, truePeakDb: -20 },
      profile: AUDIO_RENDITION_PROFILES.sfx_positional,
    });
    expect(result.gainDb).toBeCloseTo(12, 5);
    expect(result.findings.filter((entry) => entry.severity === 'error')).toEqual([]);
  });

  test('an unmeasurable clip is refused rather than given a gain', () => {
    const result = computeRmsNormalisationGain({
      analysis: { rmsDbfs: null, truePeakDb: null },
      profile: AUDIO_RENDITION_PROFILES.sfx_positional,
    });
    expect(result.gainDb).toBe(0);
    expect(codes(result.findings)).toContain('loudness_out_of_tolerance');
  });
});

describe('ffmpeg finishing plan', () => {
  const loudness = { inputI: -20, inputTp: -3, inputLra: 6, inputThresh: -30, offset: 0.1 };

  test('every argument is a separate array entry — no shell string, ever', () => {
    const plan = buildFfmpegRenditionPlan({
      inputPath: '/masters/cue 1; rm -rf /tmp/x.wav',
      outputPath: '/out/cue.webm',
      profile: 'music_runtime',
      loudness,
    });
    expect(Array.isArray(plan.args)).toBe(true);
    expect(plan.args.every((arg) => typeof arg === 'string')).toBe(true);
    // The path is one argv entry and is never interpreted by a shell.
    expect(plan.args).toContain('/masters/cue 1; rm -rf /tmp/x.wav');
    expect(plan.args).not.toContain('-filter_complex"');
    expect(plan.args).toContain('-c:a');
    expect(plan.args).toContain('libopus');
    expect(plan.args).toContain('-ar');
    expect(plan.args).toContain('48000');
    expect(plan.args).toContain('-ac');
    expect(plan.args).toContain('2');
    expect(plan.filterChain).toContain('I=-18.0000');
    expect(plan.filterChain).toContain('TP=-1.0000');
  });

  test('a path that would be read as a flag is rejected', () => {
    expect(() => assertSafeFfmpegPath('-i/etc/passwd', 'input path')).toThrow(/option/);
    expect(() => assertSafeFfmpegPath('', 'input path')).toThrow(/empty/);
  });

  test('a normalised profile refuses to plan without measurements', () => {
    expect(() =>
      buildFfmpegRenditionPlan({
        inputPath: '/masters/cue.wav',
        outputPath: '/out/cue.webm',
        profile: 'music_runtime',
      }),
    ).toThrow(/measurements are required/);
  });

  test('a loop with a crossfade builds a labelled graph consumed by [out]', () => {
    const plan = buildFfmpegRenditionPlan({
      inputPath: '/masters/cue.wav',
      outputPath: '/out/cue.webm',
      profile: 'music_runtime',
      loudness,
      inputSampleRate: SAMPLE_RATE,
      loop: { loopStartSample: 0, loopEndSample: 192_000, crossfadeSamples: 480 },
    });
    expect(plan.filterChain).toContain('acrossfade');
    expect(plan.filterChain).toContain('atrim=start_sample=0:end_sample=192000');
    expect(plan.filterChain.endsWith('[out]')).toBe(true);
    const mapIndex = plan.args.indexOf('-map');
    expect(plan.args[mapIndex + 1]).toBe('[out]');
  });

  test('a loop without normalisation still maps the loop chain', () => {
    const plan = buildFfmpegRenditionPlan({
      inputPath: '/masters/cue.wav',
      outputPath: '/out/cue.wav',
      profile: 'archival_master',
      inputSampleRate: SAMPLE_RATE,
      loop: { loopStartSample: 0, loopEndSample: 96_000 },
    });
    expect(plan.filterChain.endsWith('[out]')).toBe(true);
    const mapIndex = plan.args.indexOf('-map');
    expect(plan.args[mapIndex + 1]).toBe('[out]');
  });

  test('no filters means the input stream is mapped directly', () => {
    const plan = buildFfmpegRenditionPlan({
      inputPath: '/masters/cue.wav',
      outputPath: '/out/cue.wav',
      profile: 'archival_master',
    });
    expect(plan.filterChain).toBe('');
    const mapIndex = plan.args.indexOf('-map');
    expect(plan.args[mapIndex + 1]).toBe('0:a:0');
    expect(plan.args).toContain('-map_metadata');
  });

  test('a one-shot plan applies the calibrated gain', () => {
    const plan = buildFfmpegRenditionPlan({
      inputPath: '/masters/slam.wav',
      outputPath: '/out/slam.wav',
      profile: 'sfx_positional',
      gainDb: -3.5,
    });
    expect(plan.filterChain).toContain('volume=-3.5000dB');
    expect(plan.args).toContain('pcm_s16le');
    expect(plan.args).toContain('1');
  });

  test('a non-finite filter value is rejected', () => {
    expect(() =>
      buildFfmpegRenditionPlan({
        inputPath: '/masters/slam.wav',
        outputPath: '/out/slam.wav',
        profile: 'sfx_positional',
        gainDb: Number.NaN,
      }),
    ).toThrow(/finite/);
  });
});

describe('profile verification', () => {
  test('flags a rendition whose decoded rate does not match the profile', () => {
    const findings = verifyRenditionAgainstProfile({
      rendition: {
        profileId: 'music_runtime',
        byteLength: 1_000,
        sampleRate: 44_100,
        channels: 2,
        sampleCount: 44_100,
        durationSeconds: 1,
        extension: '.webm',
        analysis: {
          integratedLufs: -18,
          truePeakDb: -2,
          samplePeakDb: -3,
          rmsDbfs: -20,
          dcOffset: 0,
          clippedSampleCount: 0,
          nonfiniteSampleCount: 0,
          silenceRatio: 0,
          silenceTailSeconds: 0,
        },
      },
    });
    expect(codes(findings)).toContain('sample_rate_out_of_bounds');
    expect(findings.find((entry) => entry.code === 'sample_rate_out_of_bounds')?.measured).toBe(
      44_100,
    );
  });

  test('flags a container the installed catalog cannot install', () => {
    const findings = verifyRenditionAgainstProfile({
      rendition: {
        profileId: 'music_runtime',
        byteLength: 1_000,
        sampleRate: 48_000,
        channels: 2,
        sampleCount: 48_000,
        durationSeconds: 1,
        extension: '.opus',
        analysis: {
          integratedLufs: -18,
          truePeakDb: -2,
          samplePeakDb: -3,
          rmsDbfs: -20,
          dcOffset: 0,
          clippedSampleCount: 0,
          nonfiniteSampleCount: 0,
          silenceRatio: 0,
          silenceTailSeconds: 0,
        },
      },
    });
    expect(codes(findings)).toContain('container_not_installable');
  });
});
