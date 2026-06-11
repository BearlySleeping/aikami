// scripts/src/lib/tmux/cli.ts
// Shared CLI argument parsing for tmux scripts.
//
// Usage:
//   bun tmux:start <services>  [--mode <mode>] [--join] [--force]
//   bun tmux:stop  <services>  [--mode <mode>] [--force]
//   bun tmux:join              [--mode <mode>]
//   bun tmux:list              [--mode <mode>]
//
//   <services> = comma-separated: emulator,client,voice  or  all
//   Aliases: emulator → emulators
//
// Mode defaults to AIKAMI_MODE env var, required if not set.

import {
  type AikamiMode,
  type DevService,
  expandServices,
  normalizeService,
  type ServiceInput,
} from './session.ts';

const VALID_MODES: AikamiMode[] = ['emulator', 'staging', 'production'];

export type ServiceArgs = {
  services: DevService[];
  mode: AikamiMode;
  join: boolean;
  force: boolean;
};

export type ModeArgs = {
  mode: AikamiMode;
};

export const parseServices = (raw: string): DevService[] => {
  const inputs = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean) as ServiceInput[];

  if (inputs.length === 0) {
    throw new Error(
      'No services specified. Use: emulator(s), client, voice, image, text, all (comma-separated)',
    );
  }

  for (const input of inputs) {
    normalizeService(input);
  }

  return expandServices(inputs);
};

export const resolveMode = (args: string[]): AikamiMode => {
  const modeIndex = args.indexOf('--mode');
  if (modeIndex !== -1 && args[modeIndex + 1]) {
    const val = args[modeIndex + 1];
    if (!VALID_MODES.includes(val as AikamiMode)) {
      console.error(`Invalid mode: ${val}. Valid: ${VALID_MODES.join(', ')}`);
      process.exit(1);
    }
    return val as AikamiMode;
  }

  const envMode = process.env.AIKAMI_MODE;
  if (envMode && VALID_MODES.includes(envMode as AikamiMode)) {
    return envMode as AikamiMode;
  }

  console.error(
    `No mode specified. Set AIKAMI_MODE env var or use --mode <mode>.\n` +
      `Valid modes: ${VALID_MODES.join(', ')}`,
  );
  process.exit(1);
};

export const parseServiceArgs = (args: string[]): ServiceArgs => {
  const serviceArg = args.find((a) => !a.startsWith('--'));
  if (!serviceArg) {
    console.error(
      'Usage: bun tmux:start <services> [--mode <mode>] [--join] [--force]\n' +
        '  services: emulator(s), client, voice, image, text, all (comma-separated)\n' +
        '  mode:     emulator | staging | production (default: $AIKAMI_MODE)\n' +
        '  --join:   attach to session after starting\n' +
        '  --force:  kill and recreate if session already exists\n',
    );
    process.exit(1);
  }

  let services: DevService[];
  try {
    services = parseServices(serviceArg);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }

  const mode = resolveMode(args);
  const join = args.includes('--join') || args.includes('-j');
  const force = args.includes('--force') || args.includes('-f');

  return { services, mode, join, force };
};

export const parseModeArgs = (args: string[]): ModeArgs => {
  const mode = resolveMode(args);
  return { mode };
};
