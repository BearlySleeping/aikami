// .pi/extensions/lib/bridge.ts
//
// The ONE bridge from pi extensions (Node runtime) into Aikami script code
// (Bun runtime).
//
// 🔴 WHY THIS EXISTS — pi's bin is `#!/usr/bin/env node`, so every extension
// and everything it statically imports executes under Node. Bun APIs
// (`Bun.*`), Bun-only dependencies, and tsconfig path aliases do not exist
// there. Extensions therefore import *types and pure constants only*, and
// delegate every piece of runtime behavior to a `bun run` subprocess through
// this helper. That keeps the Bun/Node boundary in exactly one place and lets
// scripts use Bun freely.
//
// Protocol: spawn
//   bun run <repo>/scripts/src/lib/pi/index.ts <command>
// with a JSON request on stdin and read a JSON envelope from stdout:
//   { "ok": true,  "data": ... }
//   { "ok": false, "error": { "message": ..., "name": ..., "stack": ... } }
// The dispatcher routes all incidental `console.log` output to stderr, so
// stdout is always pure JSON.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type RunCommandOptions, runCommand } from './process_runner.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the monorepo root (this file lives at <root>/.pi/extensions/lib). */
export const REPO_ROOT = join(HERE, '..', '..', '..');

const DISPATCHER = join(REPO_ROOT, 'scripts', 'src', 'lib', 'pi', 'index.ts');

/** Shape of the envelope the dispatcher writes to stdout. */
type BridgeEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { message: string; name?: string; stack?: string; details?: unknown } };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Parse and validate one dispatcher response before consumers access branch fields. */
export const parseBridgeEnvelope = <T>(options: {
  command: string;
  stdout: string;
  stderr?: string;
}): BridgeEnvelope<T> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(options.stdout);
  } catch {
    throw new BridgeError({
      message:
        `Bridged command '${options.command}' returned non-JSON output: ${options.stdout.slice(0, 500)}` +
        (options.stderr ? `\nstderr: ${options.stderr.slice(0, 500)}` : ''),
      name: 'BridgeProtocolError',
    });
  }

  if (!isRecord(parsed) || typeof parsed.ok !== 'boolean') {
    throw new BridgeError({
      message: `Bridged command '${options.command}' returned an invalid response envelope.`,
      name: 'BridgeProtocolError',
    });
  }

  if (parsed.ok) {
    if (!Object.hasOwn(parsed, 'data')) {
      throw new BridgeError({
        message: `Bridged command '${options.command}' returned a success envelope without data.`,
        name: 'BridgeProtocolError',
      });
    }
    return { ok: true, data: parsed.data as T };
  }

  if (
    !isRecord(parsed.error) ||
    typeof parsed.error.message !== 'string' ||
    (parsed.error.name !== undefined && typeof parsed.error.name !== 'string') ||
    (parsed.error.stack !== undefined && typeof parsed.error.stack !== 'string')
  ) {
    throw new BridgeError({
      message: `Bridged command '${options.command}' returned an invalid error envelope.`,
      name: 'BridgeProtocolError',
    });
  }

  return {
    ok: false,
    error: {
      message: parsed.error.message,
      name: parsed.error.name,
      stack: parsed.error.stack,
      details: parsed.error.details,
    },
  };
};

/** Raised when a bridged script reports failure (or cannot be run at all). */
export class BridgeError extends Error {
  readonly details: unknown;

  constructor(options: { message: string; name?: string; details?: unknown }) {
    super(options.message);
    this.name = options.name ?? 'BridgeError';
    this.details = options.details;
  }
}

export type BridgeOptions = Omit<RunCommandOptions, 'input'>;

/**
 * Invoke a Bun-side command and return its decoded `data`.
 *
 * @param command e.g. `"herdr.session.start"`.
 * @param payload JSON-serializable arguments for the command.
 * @throws {BridgeError} when the command fails or returns a malformed envelope.
 */
export const runPiScript = async <T>(
  command: string,
  payload?: unknown,
  options: BridgeOptions = {},
): Promise<T> => {
  const request = JSON.stringify({ command, cwd: options.cwd, payload: payload ?? {} });

  const result = await runCommand('bun', ['run', DISPATCHER, command], {
    ...options,
    cwd: options.cwd ?? REPO_ROOT,
    input: request,
  });

  if (result.killed) {
    throw new BridgeError({
      message: `Bridged command '${command}' was cancelled or timed out.`,
      name: 'BridgeCancelledError',
    });
  }

  const stdout = result.stdout.trim();
  if (!stdout) {
    throw new BridgeError({
      message:
        `Bridged command '${command}' produced no output` +
        (result.stderr ? `: ${result.stderr.slice(0, 500)}` : '.'),
      name: 'BridgeProtocolError',
    });
  }

  const envelope = parseBridgeEnvelope<T>({ command, stdout, stderr: result.stderr });

  if (!envelope.ok) {
    throw new BridgeError({
      message: envelope.error.message,
      name: envelope.error.name,
      details: envelope.error.details,
    });
  }

  return envelope.data;
};
