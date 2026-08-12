// scripts/src/lib/agents/contract_pipeline/alarm.ts
//
// Cross-platform pipeline alarm. Plays .pi/sounds/alarm.wav (PCM WAV — the
// only format every OS player AND the Windows SoundPlayer accept natively)
// fire-and-forget after a short delay, so the review tab/terminal has time to
// render before the chime and the pipeline never blocks on audio.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Relative to the repo root (pipeline may be invoked from root or scripts/). */
export const ALARM_FILE = '.pi/sounds/alarm.wav';

/** Delay before the chime so the review pane renders first. */
export const ALARM_DELAY_MS: number = Number(process.env.CONTRACT_ALARM_DELAY_MS) || 800;

/**
 * Locate the alarm WAV by walking up from the cwd to the repo root.
 * Falls back to the cwd-relative path when not found.
 */
export const resolveAlarmFile = (): string => {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, ALARM_FILE);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return join(process.cwd(), ALARM_FILE);
};

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
 * Play the alarm after a small delay. Never throws and never keeps the
 * process alive — audio must not be able to break the pipeline.
 */
export const playAlarm = (options: { delayMs?: number } = {}): void => {
  if (process.env.CONTRACT_ALARM === '0') {
    return;
  }
  const delay = options.delayMs ?? ALARM_DELAY_MS;
  const timer = setTimeout(() => {
    try {
      const argv = playerFor(process.platform, (bin) => Bun.which(bin));
      if (!argv) {
        return;
      }
      const child = spawn(argv[0], argv.slice(1), {
        stdio: 'ignore',
        detached: true,
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
  }, delay);
  timer.unref();
};
