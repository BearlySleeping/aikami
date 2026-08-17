/**
 * apps/backend/local-stack/stack/init.ts
 *
 * `stack init` — hardware detection, modality selection, model
 * recommendation, and .env generation (C-391).
 *
 * New-user story:
 *   bun run stack init
 * answers up to three questions and gets a .env matched to their machine
 * plus an explicit plan of what will be downloaded — before anything is
 * fetched.
 *
 * Fully scriptable:
 *   bun run stack init --yes --backend cuda --modalities text,voice --tier auto
 *   bun run stack init --yes --json
 *   bun run stack init --yes --text-source ollama   # skip the probe, always reuse
 *
 * Behaviour contract (AC-1..AC-13):
 *   - Detection is entirely local, each probe capped at 1 s, no network —
 *     except the loopback-only Ollama probe (`--text-source auto`, the
 *     default), which exists purely for interop with an already-running
 *     Ollama server on the text engine's port; see detect_ollama.ts.
 *   - Every probe failure degrades to a partial profile — never an error.
 *   - The plan is shown BEFORE anything is written; declining writes nothing.
 *   - `init` never downloads; use `--fetch` to chain C-390's fetcher.
 *   - Re-running diffs the existing .env and requires confirmation; the
 *     previous file is backed up; writes are atomic (temp + rename).
 *   - Insufficient disk fails before writing, states the shortfall in GB,
 *     and suggests the next tier down.
 *   - `--json` emits a single schema-valid JSON document with the full
 *     HardwareProfile and StackPlan.
 *   - Respects NO_COLOR; output is plain text without colour or Unicode
 *     when a non-TTY or NO_COLOR is present.
 */

import { join } from 'node:path';
import process from 'node:process';
import type {
  HardwareProfile,
  ModelManifest,
  StackBackend,
  StackModality,
  StackPlan,
} from '@aikami/local-ai';
import { detectHardware, loadManifest, recommend } from '@aikami/local-ai';
import { HardwareProfileSchema, StackPlanSchema } from '@aikami/schemas';
import { Value } from 'typebox/value';
import { probeOllama } from './detect_ollama.ts';
import { cudaExtras, diffEnv, readExistingEnv, renderEnv, writeEnvAtomic } from './env_writer.ts';
import { probeExecutor } from './probe_executor.ts';

export type CliOptions = {
  yes: boolean;
  backend?: StackBackend;
  modalities?: readonly StackModality[];
  tier?: 'auto' | 'cpu' | '8gb' | '16gb';
  json: boolean;
  fetch: boolean;
  envPath?: string;
  manifestPath?: string;
  noColor: boolean;
  diskPath?: string;
  /**
   * Where the `text` modality's engine comes from:
   *   - `auto` (default): probe port 11434 for an already-running Ollama
   *     server and offer to reuse it instead of starting the bundled
   *     llama.cpp engine.
   *   - `bundled`: skip the probe, always use the bundled engine.
   *   - `ollama`: skip the probe, always reuse an existing Ollama server
   *     without asking (for scripting when you know one is there).
   */
  textSource?: 'auto' | 'bundled' | 'ollama';
};

const DEFAULT_MODALITIES: readonly StackModality[] = ['text', 'image', 'voice', 'stt'];
const MODALITY_CHOICES: readonly StackModality[] = ['text', 'image', 'voice', 'stt', 'client'];
const BACKEND_CHOICES: readonly StackBackend[] = [
  'cpu',
  'cuda',
  'rocm',
  'vulkan',
  'intel',
  'musa',
  'metal',
];

const hasColor = (noColor: boolean): boolean =>
  !noColor && !process.env.NO_COLOR && Boolean(process.stdout.isTTY);

const color = (code: string, text: string, enabled: boolean): string =>
  enabled ? `\u001b[${code}m${text}\u001b[0m` : text;

/** Formats bytes as "X.X GB" (decimal, for user-facing sizes). */
const formatGb = (bytes: number): string => `${(bytes / 1e9).toFixed(1)} GB`;

/** Port table shown in the plan (matches development_ports.ts defaults). */
const PORTS: Readonly<Partial<Record<StackModality, number>>> = {
  text: 11434,
  image: 8188,
  voice: 8089,
  stt: 8087,
  client: 5274,
} as const;

/**
 * Renders the plan to a plain-text block (AC-7): backend, per-model sizes
 * with one-line rationale, total download, free disk, licences, bound
 * ports, and warnings. No Unicode box-drawing; safe for NO_COLOR / non-TTY.
 */
export const renderPlan = (options: {
  readonly profile: HardwareProfile;
  readonly plan: StackPlan;
  readonly colorEnabled: boolean;
  /** Set when `text` was dropped in favour of a detected/forced host Ollama (see detect_ollama.ts). */
  readonly hostOllamaPort?: number;
}): string => {
  const { profile, plan, colorEnabled, hostOllamaPort } = options;
  const c = (code: string, text: string): string => color(code, text, colorEnabled);
  const out: string[] = [];

  out.push(c('1;36', 'Aikami local stack — plan'));
  out.push('');
  out.push(
    `  Backend          ${c('1', plan.backend)}${plan.nativeEngines ? ' (native engines — macOS)' : ''}`,
  );
  out.push(`  Modalities       ${plan.modalities.join(', ') || '(none)'}`);
  if (hostOllamaPort !== undefined) {
    out.push(
      `  Text engine      existing Ollama on port ${hostOllamaPort} (detected; not started by compose)`,
    );
  }
  out.push(
    `  Hardware         ${profile.gpu.vendor === 'none' ? 'CPU-only' : `${profile.gpu.vendor} ${profile.gpu.name ?? ''}`.trim()}${profile.gpu.vramMb ? ` · ${profile.gpu.vramMb} MiB VRAM` : ''}`,
  );
  if (plan.models.length > 0) {
    out.push('');
    out.push(c('1', '  Models to download'));
    for (const model of plan.models) {
      out.push(`    - ${c('1', model.manifestId)} (${formatGb(model.bytes)}) — ${model.rationale}`);
      if (model.requiresAcknowledgement) {
        out.push(`      ${c('1;33', `licence: ${model.license} (use-restricted — accepted)`)}`);
      }
    }
    out.push(`  Total download   ${c('1', formatGb(plan.totalDownloadBytes))}`);
  } else {
    out.push('  Models           (none selected)');
  }
  out.push(`  Free disk        ${formatGb(profile.freeDiskBytes)}`);
  const boundPorts = plan.modalities
    .map((modality) =>
      PORTS[modality] !== undefined ? `${modality}=${PORTS[modality]}` : undefined,
    )
    .filter((part): part is string => part !== undefined);
  if (boundPorts.length > 0) {
    out.push(`  Ports            ${boundPorts.join('  ')}`);
  }
  if (plan.nativeEngines) {
    out.push('  Engines          run natively (bin/run-native-*.sh)');
  }
  if (plan.warnings.length > 0) {
    out.push('');
    out.push(c('1;33', '  Warnings'));
    for (const warning of plan.warnings) {
      out.push(`    - ${warning}`);
    }
  }
  return out.join('\n') + '\n';
};

/** Reads the manifest from the default or provided path. */
const readManifest = async (manifestPath?: string): Promise<ModelManifest> => {
  const path = manifestPath ?? join(import.meta.dir, 'models.manifest.json');
  return loadManifest({ executor: probeExecutor, path });
};

/** Asks one yes/no question on the TTY. Returns the default when non-TTY. */
const confirm = async (prompt: string, defaultValue: boolean): Promise<boolean> => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return defaultValue;
  }
  process.stdout.write(`${prompt} ${defaultValue ? '[Y/n]' : '[y/N]'} `);
  const input = await new Promise<string>((resolve) => {
    const stdin = process.stdin;
    stdin.resume();
    let data = '';
    stdin.setEncoding('utf8');
    const onData = (chunk: string): void => {
      data += chunk;
      if (data.includes('\n') || data.includes('\r')) {
        stdin.pause();
        stdin.off('data', onData);
        resolve(data.trim());
      }
    };
    stdin.on('data', onData);
  });
  if (input.length === 0) {
    return defaultValue;
  }
  return /^y(es)?$/i.test(input);
};

/** Asks a choice question on the TTY, returning the default when non-TTY. */
const choose = async (
  prompt: string,
  choices: readonly string[],
  defaultValue: string,
): Promise<string> => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return defaultValue;
  }
  process.stdout.write(`${prompt} [${choices.join('/')}] (default: ${defaultValue}) `);
  const input = await new Promise<string>((resolve) => {
    const stdin = process.stdin;
    stdin.resume();
    let data = '';
    stdin.setEncoding('utf8');
    const onData = (chunk: string): void => {
      data += chunk;
      if (data.includes('\n') || data.includes('\r')) {
        stdin.pause();
        stdin.off('data', onData);
        resolve(data.trim());
      }
    };
    stdin.on('data', onData);
  });
  if (input.length === 0) {
    return defaultValue;
  }
  const match = choices.find((choice) => choice.toLowerCase() === input.toLowerCase());
  return match ?? defaultValue;
};

/** Injectable dependencies for `runInit` — overridden only by tests, real adapters by default. */
export type RunInitDeps = {
  /** Defaults to `detect_ollama.ts`'s real loopback probe. */
  readonly probeOllama?: (port: number) => Promise<boolean>;
};

/** Runs the full init flow. Returns the process exit code. */
export const runInit = async (options: CliOptions, deps: RunInitDeps = {}): Promise<number> => {
  const probeOllamaFn = deps.probeOllama ?? probeOllama;
  const colorEnabled = hasColor(options.noColor);
  const c = (code: string, text: string): string => color(code, text, colorEnabled);

  // ── Detection (entirely local; probes capped at 1 s each) ────────────
  const platform =
    process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const profile = await detectHardware({
    executor: probeExecutor,
    platform,
    arch,
    diskPath: options.diskPath,
  });

  // ── Manifest ──────────────────────────────────────────────────────────
  let manifest: ModelManifest;
  try {
    manifest = await readManifest(options.manifestPath);
  } catch (error) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error(
      c(
        '1;31',
        `error: cannot read models.manifest.json: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    return 1;
  }

  // ── Modalities (flag > TTY prompt > default) ─────────────────────────
  let modalities = options.modalities ?? DEFAULT_MODALITIES;
  if (!options.yes && !options.modalities) {
    const picked = await choose(
      'Which engines do you want?',
      MODALITY_CHOICES,
      DEFAULT_MODALITIES.join(','),
    );
    modalities = picked
      .split(',')
      .map((part) => part.trim())
      .filter((part): part is StackModality => MODALITY_CHOICES.includes(part as StackModality));
  }

  // ── Host Ollama detection (auto by default) ───────────────────────────
  // 11434 is Ollama's own default and is what the client's Ollama provider
  // and the Tauri CSP allowlist already expect (README "Ports are
  // deliberate") — so a user who already runs Ollama there doesn't have a
  // conflict to resolve, they have a redundant download and a container
  // that will fail to bind. Offer to just point at what's already running.
  const textSource = options.textSource ?? 'auto';
  const textPort = PORTS.text;
  let hostOllamaPort: number | undefined;
  if (modalities.includes('text') && textSource !== 'bundled' && textPort !== undefined) {
    const detected = textSource === 'ollama' ? true : await probeOllamaFn(textPort);
    if (detected) {
      const reuse =
        textSource === 'ollama' || options.yes
          ? true
          : await confirm(
              `Detected an Ollama server already on port ${textPort} — use it instead of starting the bundled text engine?`,
              true,
            );
      if (reuse) {
        hostOllamaPort = textPort;
        modalities = modalities.filter((modality) => modality !== 'text');
        // biome-ignore lint/suspicious/noConsole: CLI output
        console.log(
          c(
            '1;36',
            `→ using existing Ollama on port ${textPort}; the bundled text engine will not be started.`,
          ),
        );
      } else {
        // biome-ignore lint/suspicious/noConsole: CLI output
        console.log(
          c(
            '1;33',
            `⚠ port ${textPort} is already in use by Ollama — stop it before \`docker compose up\`, or the text container will fail to bind. (11434 is fixed by the Tauri CSP allowlist and can't be remapped.)`,
          ),
        );
      }
    }
  }

  // ── Backend (flag > prompt > auto) ────────────────────────────────────
  let backendOverride: StackBackend | undefined = options.backend;
  if (!options.yes && !options.backend) {
    const detected =
      profile.gpu.vendor === 'nvidia' && profile.gpuPassthroughReady
        ? 'cuda'
        : profile.gpu.vendor === 'amd'
          ? 'rocm'
          : profile.gpu.vendor === 'intel'
            ? 'vulkan'
            : profile.platform === 'darwin'
              ? 'metal'
              : 'cpu';
    const picked = await choose('Hardware backend?', BACKEND_CHOICES, detected);
    if (picked !== 'auto') {
      backendOverride = picked as StackBackend;
    }
  }

  // ── Tier (flag > prompt > auto) ──────────────────────────────────────
  let tierOverride: 'auto' | 'cpu' | '8gb' | '16gb' = options.tier ?? 'auto';
  if (!options.yes && !options.tier) {
    const picked = await choose('Model tier?', ['auto', 'cpu', '8gb', '16gb'], 'auto');
    tierOverride = picked as 'auto' | 'cpu' | '8gb' | '16gb';
  }

  // ── Recommendation ────────────────────────────────────────────────────
  const plan = recommend({
    profile,
    modalities,
    manifest,
    backendOverride,
    tierOverride: tierOverride === 'auto' ? undefined : tierOverride,
  });

  // ── Disk check (AC-6): fail before writing, state shortfall in GB ────
  if (plan.totalDownloadBytes > profile.freeDiskBytes) {
    const shortfall = (plan.totalDownloadBytes - profile.freeDiskBytes) / 1e9;
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error(
      c(
        '1;31',
        `error: ${formatGb(plan.totalDownloadBytes)} download needs ${formatGb(profile.freeDiskBytes)} free — short by ${shortfall.toFixed(1)} GB on this volume.`,
      ),
    );
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error(c('1;33', 'Try a smaller tier (`--tier cpu`) or free disk space, then re-run.'));
    return 2;
  }

  // ── JSON output (AC-13) ───────────────────────────────────────────────
  if (options.json) {
    const profileValid = Value.Check(HardwareProfileSchema, profile);
    const planValid = Value.Check(StackPlanSchema, plan);
    if (!profileValid || !planValid) {
      // biome-ignore lint/suspicious/noConsole: CLI output
      console.error(c('1;31', 'error: internal — profile or plan failed schema validation'));
      return 1;
    }
    const doc = { profile, plan };
    process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);
    return 0;
  }

  // ── Plan presentation (AC-7) ──────────────────────────────────────────
  process.stdout.write(renderPlan({ profile, plan, colorEnabled, hostOllamaPort }));

  // ── Confirmation (AC-7): declining writes nothing ────────────────────
  const confirmed = options.yes ? true : await confirm('Write .env?', true);
  if (!confirmed) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log('Aborted — nothing written.');
    return 0;
  }

  // ── Re-run diff (AC-9) ────────────────────────────────────────────────
  const envPath = options.envPath ?? join(import.meta.dir, '..', '.env');
  const existing = await readExistingEnv(envPath);
  const content = renderEnv({
    profile,
    plan,
    manifest,
    extras: plan.backend === 'cuda' ? cudaExtras(profile) : undefined,
    hostOllamaPort,
  });
  if (existing !== undefined) {
    process.stdout.write(`\n${diffEnv(existing, content)}\n`);
    if (!options.yes) {
      const overwrite = await confirm('An .env already exists — overwrite?', false);
      if (!overwrite) {
        // biome-ignore lint/suspicious/noConsole: CLI output
        console.log('Aborted — existing .env left untouched.');
        return 0;
      }
    }
  }

  // ── Atomic write (Quality: temp + rename, backup preserved) ──────────
  try {
    await writeEnvAtomic({ path: envPath, content });
  } catch (error) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error(
      c(
        '1;31',
        `error: failed to write ${envPath}: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    return 1;
  }
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log(c('1;32', `✓ wrote ${envPath}`));
  if (plan.warnings.length > 0) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(c('1;33', `⚠ ${plan.warnings.length} warning(s) — review above.`));
  }

  // ── Optional fetcher chaining (--fetch, off by default) ───────────────
  // Chain C-390's fetcher against EXACTLY the planned models: same manifest
  // path, the planned modalities as profiles, the licences the plan already
  // surfaced as accepted (use-restricted entries were shown in the plan),
  // and the plan's manifestId list. The fetcher downloads only these ids —
  // never the default profiles or the full manifest.
  if (options.fetch) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log('Running the model fetcher (--fetch)...');
    const { run } = await import('./fetch_models.ts');
    return await run({
      manifestPath: options.manifestPath,
      profiles: plan.modalities.join(','),
      acceptLicenses:
        plan.models
          .filter((model) => model.requiresAcknowledgement)
          .map((model) => model.license)
          .join(',') || undefined,
      entryIds: plan.models.map((model) => model.manifestId),
    });
  }

  return 0;
};

/** Parses argv into CliOptions. Unknown flags are ignored with a warning. */
export const parseArgs = (argv: readonly string[]): CliOptions => {
  const options: CliOptions = {
    yes: false,
    json: false,
    fetch: false,
    noColor: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    const next = (): string | undefined => argv[i + 1];
    switch (arg) {
      case '--yes':
      case '-y':
        options.yes = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--fetch':
        options.fetch = true;
        break;
      case '--no-color':
        options.noColor = true;
        break;
      case '--backend': {
        // `auto` means “decide from the detected profile” — it must not
        // reach planning as a literal backend because selectBackend() and
        // renderEnv() cannot resolve it. Map it to undefined (no override).
        const raw = next();
        options.backend = raw === undefined || raw === 'auto' ? undefined : (raw as StackBackend);
        i += 1;
        break;
      }
      case '--modalities':
        options.modalities = (next() ?? '')
          .split(',')
          .map((part) => part.trim())
          .filter((part): part is StackModality =>
            ['text', 'image', 'voice', 'stt', 'client', 'ollama', 'comfyui'].includes(part),
          );
        i += 1;
        break;
      case '--tier':
        options.tier = next() as 'auto' | 'cpu' | '8gb' | '16gb';
        i += 1;
        break;
      case '--text-source': {
        const raw = next();
        if (raw === 'auto' || raw === 'bundled' || raw === 'ollama') {
          options.textSource = raw;
        }
        i += 1;
        break;
      }
      case '--env-path':
        options.envPath = next();
        i += 1;
        break;
      case '--manifest-path':
        options.manifestPath = next();
        i += 1;
        break;
      case '--disk-path':
        options.diskPath = next();
        i += 1;
        break;
      default:
        if (arg.startsWith('-')) {
          // biome-ignore lint/suspicious/noConsole: CLI output
          console.warn(`ignoring unknown flag: ${arg}`);
        }
        break;
    }
  }
  return options;
};

if (import.meta.main) {
  const options = parseArgs(process.argv.slice(2));
  process.exit(await runInit(options));
}
