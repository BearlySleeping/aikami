// scripts/src/lib/herdr/cli.ts
// Shared CLI argument parsing for herdr scripts.
//
// Usage:
//   bun herdr:start <services>  [--mode <mode>] [--join] [--force] [--force-ports]
//   bun herdr:stop  <services>  [--mode <mode>] [--force]
//   bun herdr:join              [--mode <mode>]
//   bun herdr:list              [--mode <mode>]
//
//   <services> = comma-separated: firebase,client,voice,image,text  or  all
//
// Mode defaults to AIKAMI_MODE env var, falling back to emulator when
// neither is set.

import { isAikamiMode, resolveAikamiMode } from '../env/mode';
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
  /** Kill whatever's already bound to each target port before starting. */
  forcePorts: boolean;
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
      'No services specified. Use: firebase, client, hub, voice, image, text, text-ollama, image-comfyui, postgres, preview-client, site, preview-site, preview-hub, tauri, all (comma-separated)',
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
    if (!isAikamiMode(val)) {
      console.error(`Invalid mode: ${val}. Valid: ${VALID_MODES.join(', ')}`);
      process.exit(1);
    }
    return val;
  }

  // No --mode: fall back to AIKAMI_MODE env, defaulting to the local
  // emulator. Staging/production require credentials that fail fast anyway,
  // so an accidental default can't hit the cloud.
  return resolveAikamiMode();
};

export const parseServiceArgs = (args: string[]): ServiceArgs => {
  const serviceArg = args.find((a) => !a.startsWith('--'));
  if (!serviceArg) {
    console.error(
      'Usage: bun herdr:start <services> [--mode <mode>] [--join] [--force] [--force-ports]\n' +
        '  services:      firebase, client, hub, voice, image, text, text-ollama, image-comfyui, postgres, preview-client, site, preview-site, preview-hub, tauri, all (comma-separated)\n' +
        '  mode:          emulator | staging | production (default: emulator)\n' +
        '  --join:        attach to session after starting\n' +
        '  --force:       kill and recreate if workspace already exists\n' +
        '  --force-ports: kill whatever is bound to each target port first (e.g. a leftover process from a crashed prior run) instead of failing with EADDRINUSE\n',
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
  const forcePorts = args.includes('--force-ports');

  return { services, mode, join, force, forcePorts };
};

export const parseModeArgs = (args: string[]): ModeArgs => {
  const mode = resolveMode(args);
  return { mode };
};
