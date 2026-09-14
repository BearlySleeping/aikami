// apps/backend/local-stack/stack/generation/audio_finishing.ts
//
// C-521 AC-3/AC-4: the HOST side of audio preparation.
//
// This is the only module that spawns a process. The portable core
// (`@aikami/local-ai`) decides *what* to run and judges the result from decoded
// samples; this module runs ffmpeg with an argument array (never a shell
// string), decodes each output back to PCM, and hands the bytes back to the
// core so a rendition record can be built from what the encoder actually
// produced.
//
// Ordering inside one finishing call:
//
//   1. read the master and analyse its decoded samples (the near-silent guard
//      needs this before anything is normalised);
//   2. record the archival master rendition — the master is never rewritten;
//   3. measure the first-pass loudnorm values when the profile normalises by
//      integrated loudness (refusing to guess a gain);
//   4. run the pinned encoder plan with `Bun.spawn` and an argv array;
//   5. decode the encoded rendition back to PCM and build the rendition record;
//   6. re-locate authored loop bounds against the *decoded rendition*, because
//      encoder pre-skip drifts them.
//
// Contract: C-521 Music and SFX generation with audio preparation

import {
  type AudioRenditionProfile,
  alignLoopBoundsToRendition,
  analyseDecodedAudio,
  type BuiltAudioRendition,
  buildAudioRendition,
  buildFfmpegRenditionPlan,
  computeRmsNormalisationGain,
  decodeWav,
  findAudioRenditionProfile,
  isNearSilentMaster,
  sha256Hex,
} from '@aikami/local-ai';
import type {
  AudioFinding,
  AudioGenerationRefusal,
  AudioLoopBounds,
  AudioRendition,
  AudioRenditionProfileId,
} from '@aikami/types';

/** Decoded-command result. */
export type RunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

/** How the host executes a program. Injected so tests can pin it. */
export type CommandRunner = (
  program: string,
  args: readonly string[],
  options?: { stdinPath?: string },
) => Promise<RunResult>;

/** The default runner: `Bun.spawn` with an argv array and no shell. */
export const bunCommandRunner: CommandRunner = async (program, args, options = {}) => {
  const child = Bun.spawn([program, ...args], {
    stdin: options.stdinPath === undefined ? 'ignore' : Bun.file(options.stdinPath),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
};

/** Options for {@link finishAudioMaster}. */
export type FinishAudioMasterOptions = {
  /** Absolute path to the master (raw, unmodified). */
  masterPath: string;
  /** Absolute path the rendition is written to. */
  renditionPath: string;
  profileId: AudioRenditionProfileId;
  /** Authored loop bounds, in master sample space. */
  loop?: AudioLoopBounds;
  /** Decoded sample rate of the master, for loop time bases. */
  masterSampleRate?: number;
  createdAt: string;
  ffmpegPath?: string;
  run?: CommandRunner;
  /** Read the master bytes. Defaults to `Bun.file(...).arrayBuffer()`. */
  readFile?: (path: string) => Promise<Uint8Array>;
};

/** The outcome of finishing one master. */
export type FinishedAudioMaster = {
  /** The archival-master rendition record (always produced when the master decodes). */
  masterRendition: BuiltAudioRendition;
  /** The requested rendition, or `undefined` when the master was rejected. */
  rendition: BuiltAudioRendition | undefined;
  /** `true` when both records carry no error-severity finding. */
  accepted: boolean;
  /**
   * The typed reason no rendition was produced. Present whenever a master is
   * rejected — a caller never has to parse a message to branch on it.
   */
  refusal?: AudioGenerationRefusal;
  /** The plan that was executed, for the report. */
  planArgs?: readonly string[];
};

/** Builds the typed refusal for a rejected master. */
const masterRefusal = (options: {
  findings: readonly AudioFinding[];
  profileId: string;
  message: string;
}): AudioGenerationRefusal => ({
  code: 'master_rejected',
  message: options.message,
  modality: 'audio',
  profileId: options.profileId,
  findings: [...options.findings],
});

const defaultReadFile = async (path: string): Promise<Uint8Array> =>
  new Uint8Array(await Bun.file(path).arrayBuffer());

/** Writes bytes to a file, creating nothing implicitly. */
const defaultWriteFile = async (path: string, bytes: Uint8Array): Promise<void> => {
  await Bun.write(path, bytes);
};

/** Parses the JSON block ffmpeg's `loudnorm` prints to stderr. */
export const parseLoudnormReport = (
  stderr: string,
):
  | { inputI: number; inputTp: number; inputLra: number; inputThresh: number; offset: number }
  | undefined => {
  const match = /\{[\s\S]*"input_i"[\s\S]*\}/.exec(stderr);
  if (!match) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(match[0]) as Record<string, string>;
    const read = (key: string): number | undefined => {
      const value = Number.parseFloat(parsed[key] ?? '');
      return Number.isFinite(value) ? value : undefined;
    };
    const inputI = read('input_i');
    const inputTp = read('input_tp');
    const inputLra = read('input_lra');
    const inputThresh = read('input_thresh');
    const offset = read('target_offset');
    if (
      inputI === undefined ||
      inputTp === undefined ||
      inputLra === undefined ||
      inputThresh === undefined ||
      offset === undefined
    ) {
      return undefined;
    }
    return { inputI, inputTp, inputLra, inputThresh, offset };
  } catch {
    return undefined;
  }
};

/**
 * Runs the first-pass loudnorm measurement for a master.
 *
 * Without real measurements the plan refuses (`measurements are required`), so
 * this is the step that keeps a guessed gain out of the pipeline.
 */
const measureLoudnorm = async (options: {
  ffmpegPath: string;
  masterPath: string;
  run: CommandRunner;
  targetLufs: number;
  targetTp: number;
}): Promise<{
  inputI: number;
  inputTp: number;
  inputLra: number;
  inputThresh: number;
  offset: number;
}> => {
  const result = await options.run(options.ffmpegPath, [
    '-hide_banner',
    '-nostdin',
    '-i',
    options.masterPath,
    '-af',
    `loudnorm=I=${options.targetLufs}:TP=${options.targetTp}:print_format=json`,
    '-f',
    'null',
    '-',
  ]);
  const report = parseLoudnormReport(result.stderr);
  if (report === undefined) {
    throw new Error(
      `ffmpeg's loudnorm first pass produced no usable report (exit ${result.exitCode})`,
    );
  }
  return report;
};

/**
 * Decodes an encoded rendition back to float32 PCM WAV so the portable core can
 * measure the bytes that will actually ship — not the master's numbers.
 */
const decodeRenditionToWav = async (options: {
  ffmpegPath: string;
  renditionPath: string;
  run: CommandRunner;
  readFile: (path: string) => Promise<Uint8Array>;
  writeFile: (path: string, bytes: Uint8Array) => Promise<void>;
  scratchPath: string;
}): Promise<Uint8Array> => {
  const result = await options.run(options.ffmpegPath, [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-y',
    '-i',
    options.renditionPath,
    '-c:a',
    'pcm_f32le',
    '-f',
    'wav',
    options.scratchPath,
  ]);
  if (result.exitCode !== 0) {
    throw new Error(`decoding the rendition failed: ${result.stderr.slice(0, 400)}`);
  }
  return options.readFile(options.scratchPath);
};

/**
 * Finishes one master into its profile's rendition.
 *
 * The archival master is recorded first and is never rewritten; a master that
 * raises an error-severity finding stops the run before anything is encoded.
 */
export const finishAudioMaster = async (
  options: FinishAudioMasterOptions,
): Promise<FinishedAudioMaster> => {
  const readFile = options.readFile ?? defaultReadFile;
  const run = options.run ?? bunCommandRunner;
  const ffmpegPath = options.ffmpegPath ?? 'ffmpeg';
  const profile: AudioRenditionProfile | undefined = findAudioRenditionProfile(options.profileId);
  if (profile === undefined) {
    throw new Error(`"${options.profileId}" is not a declared audio rendition profile`);
  }

  const masterBytes = await readFile(options.masterPath);
  const masterHash = await sha256Hex(masterBytes);
  const masterRendition = await buildAudioRendition({
    encoded: masterBytes,
    decodedWav: masterBytes,
    profileId: 'archival_master',
    container: 'wav',
    codec: decodeWav(masterBytes).codec,
    mimeType: 'audio/wav',
    extension: '.wav',
    // A master is its own parent: the lineage edge for every rendition below
    // points at the archival hash.
    parentMasterHash: masterHash,
    createdAt: options.createdAt,
  });

  const masterDecoded = decodeWav(masterBytes);
  const masterAnalysis = analyseDecodedAudio(masterDecoded).analysis;

  if (!masterRendition.accepted) {
    // A rejected master is not encoded: the finding is the result.
    return {
      masterRendition,
      rendition: undefined,
      accepted: false,
      refusal: masterRefusal({
        findings: masterRendition.rendition.findings,
        profileId: profile.id,
        message: `The master was rejected before encoding (${masterRendition.rendition.findings
          .filter((entry) => entry.severity === 'error')
          .map((entry) => entry.code)
          .join(', ')}).`,
      }),
    };
  }

  // 🔴 AC-3: "a near-silent master is never normalised into a loud effect". A
  // mastering normaliser applied to a noise floor produces a loud, obviously
  // wrong cue, so ffmpeg is never asked to do it.
  if (!profile.archival && isNearSilentMaster(masterAnalysis)) {
    const finding: AudioFinding = {
      code: 'near_silent_master',
      severity: 'error',
      detail: `${profile.id} refuses to normalise a near-silent master (RMS ${masterAnalysis.rmsDbfs?.toFixed(2) ?? 'unmeasurable'} dBFS) into a loud effect`,
      ...(masterAnalysis.rmsDbfs === null ? {} : { measured: masterAnalysis.rmsDbfs }),
      limit: -60,
    };
    return {
      masterRendition,
      rendition: undefined,
      accepted: false,
      refusal: masterRefusal({
        findings: [finding],
        profileId: profile.id,
        message:
          'The master is near-silent — it is refused rather than normalised into a loud effect.',
      }),
    };
  }

  const loudness =
    profile.loudnessTargetLufs === null
      ? undefined
      : await measureLoudnorm({
          ffmpegPath,
          masterPath: options.masterPath,
          run,
          targetLufs: profile.loudnessTargetLufs,
          targetTp: profile.truePeakCeilingDbtp ?? -1,
        });

  const gain =
    profile.rmsTargetDbfs === null
      ? undefined
      : computeRmsNormalisationGain({ analysis: masterAnalysis, profile }).gainDb;

  const inputSampleRate = options.masterSampleRate ?? masterDecoded.sampleRate;
  const plan = buildFfmpegRenditionPlan({
    inputPath: options.masterPath,
    outputPath: options.renditionPath,
    profile,
    ...(loudness === undefined ? {} : { loudness }),
    ...(gain === undefined ? {} : { gainDb: gain }),
    ...(options.loop === undefined ? {} : { loop: options.loop }),
    inputSampleRate,
  });

  const encoded = await run(ffmpegPath, [...plan.args]);
  if (encoded.exitCode !== 0) {
    throw new Error(
      `ffmpeg finishing failed for ${profile.id} (exit ${encoded.exitCode}): ${encoded.stderr.slice(0, 400)}`,
    );
  }

  const renditionBytes = await readFile(options.renditionPath);
  const decodedWav =
    profile.container === 'wav'
      ? renditionBytes
      : await decodeRenditionToWav({
          ffmpegPath,
          renditionPath: options.renditionPath,
          run,
          readFile,
          writeFile: defaultWriteFile,
          scratchPath: `${options.renditionPath}.decoded.wav`,
        });

  // Encoder pre-skip drifts authored bounds; re-locate them in the decoded
  // rendition rather than assuming they still fit.
  let loop = options.loop;
  if (loop !== undefined) {
    const renditionDecoded = decodeWav(decodedWav);
    const aligned = alignLoopBoundsToRendition({
      masterChannelData: masterDecoded.channelData,
      renditionChannelData: renditionDecoded.channelData,
      loop,
      searchRadiusSamples: Math.round(inputSampleRate * 0.2),
    });
    if (aligned === undefined) {
      // Keep the authored bounds so the core reports invalid_loop_bounds rather
      // than dropping the loop silently.
      loop = { ...loop, repeatsAuditioned: 0 };
    } else {
      loop = aligned;
    }
  }

  const rendition = await buildAudioRendition({
    encoded: renditionBytes,
    decodedWav,
    profileId: profile.id,
    container: profile.container,
    codec: profile.codec,
    mimeType: `audio/${profile.container === 'webm' ? 'webm' : profile.container}`,
    extension: profile.extension,
    parentMasterHash: masterRendition.rendition.contentHash,
    masterAnalysis,
    ...(loop === undefined ? {} : { loop }),
    createdAt: options.createdAt,
  });

  return {
    masterRendition,
    rendition,
    accepted: rendition.accepted,
    planArgs: plan.args,
  };
};

/** Convenience: the rendition record, or a throw when the master was rejected. */
export const requireRendition = (finished: FinishedAudioMaster): AudioRendition => {
  if (finished.rendition === undefined) {
    throw new Error('the master was rejected — no rendition was produced');
  }
  return finished.rendition.rendition;
};
