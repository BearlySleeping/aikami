// scripts/src/lib/tmux/cli.ts
// Shared CLI argument parsing for tmux scripts.
// Reads mode from AIKAMI_MODE env var by default, or --mode flag.

import type { AikamiMode, TmuxService } from './session.ts';

const VALID_MODES: AikamiMode[] = ['emulator', 'development', 'production'];
const VALID_SERVICES: TmuxService[] = ['emulators', 'pwa', 'game', 'all'];

export type ParsedArgs = {
  service: TmuxService;
  mode: AikamiMode;
  force: boolean;
};

export const parseArgs = (args: string[]): ParsedArgs => {
  // First positional arg is service
  const serviceArg = args.find((a) => !a.startsWith('--'));
  if (!serviceArg || !VALID_SERVICES.includes(serviceArg as TmuxService)) {
    console.error(
      `Usage: <service> [--mode <mode>] [--force]\n` +
        `  service: ${VALID_SERVICES.join(' | ')}\n` +
        `  mode:    ${VALID_MODES.join(' | ')} (default: $AIKAMI_MODE)\n`,
    );
    process.exit(1);
  }

  const service = serviceArg as TmuxService;

  // --mode flag
  const modeIndex = args.indexOf('--mode');
  let mode: AikamiMode;
  if (modeIndex !== -1 && args[modeIndex + 1]) {
    const modeVal = args[modeIndex + 1];
    if (!VALID_MODES.includes(modeVal as AikamiMode)) {
      console.error(`Invalid mode: ${modeVal}. Valid: ${VALID_MODES.join(', ')}`);
      process.exit(1);
    }
    mode = modeVal as AikamiMode;
  } else {
    const envMode = process.env.AIKAMI_MODE;
    if (envMode && VALID_MODES.includes(envMode as AikamiMode)) {
      mode = envMode as AikamiMode;
    } else {
      console.error(
        `No mode specified. Set AIKAMI_MODE env var or use --mode <mode>.\n` +
          `Valid modes: ${VALID_MODES.join(', ')}`,
      );
      process.exit(1);
    }
  }

  const force = args.includes('--force') || args.includes('-f');

  return { service, mode, force };
};
