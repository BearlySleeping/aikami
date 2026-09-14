// apps/backend/local-stack/stack/pair_runner.ts
//
// C-522 — `bun run --cwd apps/backend/local-stack runner:pair`.
//
// The one tooling entry point for the paired-outbound route:
//
//   * `--pair` consumes a short-lived code the creator minted in the Hub and
//     stores the returned credential at 0600 outside the repo (never in the
//     worktree, never in a log);
//   * otherwise it loads that credential and runs the claim/status loop, so a
//     Hub job executes on *this* machine and the Hub never dials in.
//
// The engine is chosen from the profile the Hub dispatched, through the same
// `GENERATION_PROVIDER_PROFILES` registry and the same portable
// `createGenerationEngine` the CLI batch path uses. A profile this host cannot
// resolve is refused as data — the runner reports a structured failure rather
// than picking a substitute checkpoint.
//
// Contract: C-522 Hub and client access to the generation runner

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createGenerationEngine, isGenerationEngineId } from '@aikami/local-ai';
import {
  createHubDispatchExecutor,
  createHubRunnerClient,
  generationStorePaths,
  profileForItem,
  runHubRunnerLoop,
} from '@aikami/local-stack/generation';

const USAGE = `runner:pair — pair this machine with the Hub and run generation jobs

Usage:
  bun run --cwd apps/backend/local-stack runner:pair --pair --hub <URL> --code <CODE> [options]
  bun run --cwd apps/backend/local-stack runner:pair --hub <URL> [options]

Options:
  --pair                 Consume a pairing code (requires --code).
  --hub <URL>            Hub origin, e.g. https://hub.bearlysleeping.com. Required.
  --code <CODE>          The pairing code shown in the Hub. Only with --pair.
  --device-id <ID>       Stable device id. Defaults to the persisted one, then a new one.
  --label <TEXT>         Creator-visible device label. Default: the hostname.
  --resource-group <ID>  Physical resource group. Default: gpu:0.
  --modalities <LIST>    Comma-separated modalities. Default: image.
  --engine-url <URL>     Engine base URL override (per modality default otherwise).
  --runs-dir <PATH>      Durable run store root. Default: the OS cache dir.
  --lease-ttl-ms <MS>    Lease lifetime per claim. Default: 300000.
  --poll-ms <MS>         Idle poll interval. Default: 2000.
  --once                 Exit after the first idle poll (useful for smoke tests).
  --upload               Opt this device in to private preview upload.
  --show-credentials     Print the credential *path* (never the credential).
  --help                 Show this message.

Exit codes:
  0  the loop exited cleanly (--once) or a --pair succeeded
  2  invalid invocation
  3  the Hub refused the credential (revoked, expired or unknown)
  4  the Hub was unreachable
`;

/** Where the credential lives: outside the repo, owner-readable only. */
const DEFAULT_CREDENTIAL_DIR = join(homedir(), '.cache', 'aikami', 'runner');

const credentialsPath = (dir = DEFAULT_CREDENTIAL_DIR): string => join(dir, 'credentials.json');

type StoredCredentials = {
  hubOrigin: string;
  deviceId: string;
  token: string;
  label: string;
  resourceGroups: string[];
};

/** Persist the credential with owner-only permissions. */
const writeCredentials = (path: string, value: StoredCredentials): void => {
  mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  // `mode` on write is subject to umask; the explicit chmod is the guarantee.
  chmodSync(path, 0o600);
};

/** Read the stored credential, or undefined when this machine is unpaired. */
const readCredentials = (path: string): StoredCredentials | undefined => {
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) {
      return undefined;
    }
    const value = parsed as Partial<StoredCredentials>;
    if (
      typeof value.token === 'string' &&
      typeof value.deviceId === 'string' &&
      typeof value.hubOrigin === 'string'
    ) {
      return {
        hubOrigin: value.hubOrigin,
        deviceId: value.deviceId,
        token: value.token,
        label: typeof value.label === 'string' ? value.label : 'Aikami runner',
        resourceGroups: Array.isArray(value.resourceGroups)
          ? value.resourceGroups.filter((entry): entry is string => typeof entry === 'string')
          : ['gpu:0'],
      };
    }
    return undefined;
  } catch {
    // A corrupt credential file is "unpaired", not a crash.
    return undefined;
  }
};

type CliOptions = {
  pair: boolean;
  hub: string;
  code?: string;
  deviceId?: string;
  label: string;
  resourceGroup: string;
  modalities: string[];
  engineUrl?: string;
  runsDir: string;
  leaseTtlMs: number;
  pollIntervalMs: number;
  once: boolean;
  upload: boolean;
  showCredentials: boolean;
};

/** Parse `--flag value` pairs; throws a message suitable for stderr. */
export const parseOptions = (argv: readonly string[]): CliOptions | 'help' => {
  const flags = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      throw new Error(`unexpected argument "${token}"`);
    }
    const name = token.slice(2);
    if (
      name === 'pair' ||
      name === 'once' ||
      name === 'upload' ||
      name === 'show-credentials' ||
      name === 'help'
    ) {
      flags.set(name, true);
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`--${name} needs a value`);
    }
    flags.set(name, value);
    index += 1;
  }
  if (flags.has('help')) {
    return 'help';
  }
  const hub = flags.get('hub');
  if (typeof hub !== 'string') {
    throw new Error('--hub is required');
  }
  const pair = flags.get('pair') === true;
  const code = flags.get('code');
  if (pair && typeof code !== 'string') {
    throw new Error('--pair requires --code');
  }
  if (!pair && typeof code === 'string') {
    throw new Error('--code is only meaningful with --pair');
  }
  const modalities =
    typeof flags.get('modalities') === 'string'
      ? String(flags.get('modalities'))
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)
      : ['image'];
  for (const modality of modalities) {
    if (modality !== 'image' && modality !== 'audio' && modality !== 'video') {
      throw new Error(`unsupported modality "${modality}"`);
    }
  }
  const number = (name: string, fallback: number): number => {
    const raw = flags.get(name);
    if (raw === undefined) {
      return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`--${name} must be a positive number`);
    }
    return parsed;
  };
  return {
    pair,
    hub: hub.replace(/\/+$/, ''),
    ...(typeof code === 'string' ? { code } : {}),
    ...(typeof flags.get('device-id') === 'string'
      ? { deviceId: String(flags.get('device-id')) }
      : {}),
    label: typeof flags.get('label') === 'string' ? String(flags.get('label')) : 'Aikami runner',
    resourceGroup:
      typeof flags.get('resource-group') === 'string'
        ? String(flags.get('resource-group'))
        : 'gpu:0',
    modalities,
    ...(typeof flags.get('engine-url') === 'string'
      ? { engineUrl: String(flags.get('engine-url')) }
      : {}),
    runsDir:
      typeof flags.get('runs-dir') === 'string'
        ? String(flags.get('runs-dir'))
        : join(homedir(), '.cache', 'aikami', 'runner', 'runs'),
    leaseTtlMs: number('lease-ttl-ms', 300_000),
    pollIntervalMs: number('poll-ms', 2_000),
    once: flags.get('once') === true,
    upload: flags.get('upload') === true,
    showCredentials: flags.get('show-credentials') === true,
  };
};

/** The platform value the Hub's paired-device schema accepts. */
const hostPlatform = (): 'linux' | 'macos' | 'windows' | 'unknown' => {
  if (process.platform === 'darwin') {
    return 'macos';
  }
  if (process.platform === 'win32') {
    return 'windows';
  }
  if (process.platform === 'linux') {
    return 'linux';
  }
  return 'unknown';
};

/** Per-modality default engine endpoint (the local-stack compose profiles). */
const defaultEngineUrl = (modality: string): string =>
  modality === 'audio' ? 'http://127.0.0.1:8001' : 'http://127.0.0.1:8188';

/**
 * Builds the engine for a dispatched item from the profile registry.
 *
 * An unresolved profile returns `undefined`, which C-519 turns into a
 * `provider_unavailable` blocker. That is the honest answer: substituting an
 * engine the profile did not name is exactly the "silent expansion" the
 * contract forbids.
 */
const engineFactory = (engineUrl: string | undefined) => {
  const factory = ({ item }: { item: { providerProfileId: string } }) => {
    const profile = profileForItem(item as never);
    if (profile === undefined) {
      return undefined;
    }
    const engineId = profile.engineId;
    if (engineId === undefined || !isGenerationEngineId(engineId)) {
      return undefined;
    }
    return createGenerationEngine(engineId, {
      baseUrl: engineUrl ?? defaultEngineUrl(profile.modality),
    });
  };
  return factory as Parameters<typeof createHubDispatchExecutor>[0]['engineFactory'];
};

/** The entry point. Returns the process exit code. */
export const main = async (argv: readonly string[]): Promise<number> => {
  let options: CliOptions | 'help';
  try {
    options = parseOptions(argv);
  } catch (error) {
    process.stderr.write(`✗ ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 2;
  }
  if (options === 'help') {
    process.stderr.write(USAGE);
    return 2;
  }

  const path = credentialsPath();
  const stored = readCredentials(path);
  const deviceId =
    options.deviceId ?? stored?.deviceId ?? `dev_${crypto.randomUUID().replace(/-/g, '')}`;
  const client = createHubRunnerClient({
    hubOrigin: options.hub,
    ...(stored?.token === undefined || options.pair ? {} : { token: stored.token }),
  });

  if (options.pair) {
    const paired = await client.pair({
      code: options.code ?? '',
      deviceId,
      label: options.label,
      platform: hostPlatform(),
      modalities: options.modalities,
      resourceGroups: [options.resourceGroup],
      artifactUploadEnabled: options.upload,
    });
    if (!paired.ok) {
      process.stderr.write(`✗ pairing refused (${paired.code}): ${paired.message}\n`);
      return paired.code === 'transport_failed' ? 4 : 3;
    }
    writeCredentials(path, {
      hubOrigin: options.hub,
      deviceId: paired.value.device.deviceId,
      token: paired.value.token,
      label: options.label,
      resourceGroups: [options.resourceGroup],
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          deviceId: paired.value.device.deviceId,
          label: paired.value.device.label,
          tokenExpiresAt: paired.value.tokenExpiresAt,
          // The path, never the credential: stdout is routinely captured.
          credentialsPath: path,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  if (client.token() === undefined) {
    process.stderr.write(`✗ no credential at ${path} — run with --pair --code <CODE> first\n`);
    return 3;
  }
  if (options.showCredentials) {
    process.stdout.write(`${path}\n`);
  }

  const execute = createHubDispatchExecutor({
    pathsFor: (dispatch) =>
      generationStorePaths({ runsDir: options.runsDir, runId: `hub-${dispatch.jobId}` }),
    engineFactory: engineFactory(options.engineUrl),
    audioImportRoot: options.runsDir,
  });

  await runHubRunnerLoop({
    client,
    deviceId,
    resourceGroup: options.resourceGroup,
    modalities: options.modalities,
    execute,
    leaseTtlMs: options.leaseTtlMs,
    pollIntervalMs: options.pollIntervalMs,
    ...(options.once ? { idlePollsBeforeExit: 1 } : {}),
    onEvent: (event) => {
      // Structured, credential-free lines. The prompt never appears here.
      process.stdout.write(`${JSON.stringify(event)}\n`);
    },
  });
  return 0;
};

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
