// scripts/src/lib/agents/contract_pipeline/alarm.ts
//
// Cross-platform pipeline alarm. Plays .pi/sounds/alarm.wav (PCM WAV — the
// only format every OS player AND the Windows SoundPlayer accept natively)
// fire-and-forget after a short delay, so the review tab/terminal has time to
// render before the chime and the pipeline never blocks on audio.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { which } from '../../env/which';

/** Relative to the repo root (pipeline may be invoked from root or scripts/). */
export const ALARM_FILE = '.pi/sounds/alarm.wav';

/** Played on pipeline crash / signal termination — a distinct cue from the review chime. */
export const ERROR_FILE = '.pi/sounds/error.wav';

/** Delay before the chime so the review pane renders first. */
export const ALARM_DELAY_MS: number = Number(process.env.CONTRACT_ALARM_DELAY_MS) || 800;

/**
 * Locate a sound file by walking up from the cwd to the repo root.
 * Falls back to the cwd-relative path when not found.
 */
export const resolveSoundFile = (relativeFile: string): string => {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, relativeFile);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return join(process.cwd(), relativeFile);
};

/** Locate the alarm WAV. See {@link resolveSoundFile}. */
export const resolveAlarmFile = (): string => resolveSoundFile(ALARM_FILE);

/** Locate the error WAV. See {@link resolveSoundFile}. */
export const resolveErrorFile = (): string => resolveSoundFile(ERROR_FILE);

/**
 * Resolve the player argv for the current platform, or null when no player
 * (or no sound file) is available. Pure — `which` is injected for tests.
 */
export const playerFor = (
  platform: NodeJS.Platform,
  which: (bin: string) => string | null,
  file: string = resolveAlarmFile(),
): string[] | null => {
  if (!existsSync(file)) {
    return null;
  }
  if (platform === 'darwin') {
    return ['afplay', file];
  }
  if (platform === 'win32') {
    // Windows has no CLI audio player; PowerShell's SoundPlayer accepts WAV
    // only — exactly why the alarm ships as PCM WAV.
    const escaped = file.replace(/'/g, "''");
    return [
      'powershell',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(New-Object Media.SoundPlayer '${escaped}').PlaySync();`,
    ];
  }
  // Linux: PulseAudio/ALSA are lightweight and native; ffplay/mpv fall back.
  const player = ['paplay', 'aplay', 'ffplay', 'mpv'].find((bin) => which(bin) !== null);
  if (!player) {
    return null;
  }
  const args =
    player === 'ffplay'
      ? ['-nodisp', '-autoexit', '-loglevel', 'quiet', file]
      : player === 'mpv'
        ? ['--really-quiet', '--no-terminal', file]
        : player === 'aplay'
          ? ['-q', file]
          : [file]; // paplay takes no quiet flag — quiet by default.
  return [player, ...args];
};

/**
 * Spawn the platform player for `file`, detached and fire-and-forget. Never
 * throws and never keeps the process alive — audio must not be able to break
 * the pipeline. Synchronous (no setTimeout): safe to call immediately before
 * `process.exit()`, since a detached+unref'd child survives its parent exiting.
 */
const spawnPlayer = (file: string): void => {
  try {
    const argv = playerFor(process.platform, which, file);
    if (!argv) {
      return;
    }
    const [cmd, ...args] = argv;
    if (!cmd) {
      return;
    }
    const child = spawn(cmd, args, {
      stdio: 'ignore',
      detached: true,
      // Windows: powershell.exe is a console app — without windowsHide the
      // chime flashes a visible console window for the duration of
      // playback. No-op on POSIX.
      windowsHide: true,
    });
    // Async spawn failures (player vanished between the `which` probe and
    // spawn, ENOENT, …) surface as an 'error' event — without a listener
    // that unhandled event would terminate the pipeline. Playback stays
    // best-effort: swallow and move on, never rethrow.
    child.on('error', () => {});
    child.unref();
    // Safety net: kill a hung player (stuck audio pipe) after 10s.
    const killTimer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Already gone.
      }
    }, 10_000);
    killTimer.unref();
  } catch {
    // Swallow — a missing player must never crash the pipeline.
  }
};

/**
 * Play the alarm after a small delay, so a review pane has time to render
 * first. Fire-and-forget.
 */
export const playAlarm = (options: { delayMs?: number } = {}): void => {
  if (process.env.CONTRACT_ALARM === '0') {
    return;
  }
  const delay = options.delayMs ?? ALARM_DELAY_MS;
  const timer = setTimeout(() => spawnPlayer(resolveAlarmFile()), delay);
  timer.unref();
};

/**
 * Play the error chime immediately (no delay) — callers use this right
 * before `process.exit()` on a crash or signal, so the sound must be
 * dispatched synchronously rather than queued behind a timer that would
 * never fire once the event loop stops.
 */
export const playError = (): void => {
  if (process.env.CONTRACT_ALARM === '0') {
    return;
  }
  spawnPlayer(resolveErrorFile());
};
