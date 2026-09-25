// apps/e2e/src/services/port_allocation.ts
// Stable, checkout-scoped E2E port allocation.
//
// The root checkout owns the canonical emulator ports. A linked worktree must
// never silently join another checkout's dev tabs, so it receives one of the
// 163 offsets in the contract port space (66, 132, ...). The assignment is
// deterministic for a checkout and persisted outside the repository; the
// filesystem lock makes simultaneous first-time callers converge on one
// assignment instead of racing to the same slot.

import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** Number of linked-worktree slots reserved for E2E checkout isolation. */
export const E2E_PORT_SLOTS = 163;

/** Distance between adjacent E2E checkout slots. */
export const E2E_PORT_STEP = 66;

/** Base ports used by the E2E server map. Voice remains a shared singleton. */
export const E2E_PORT_BASES = {
  client: 5274,
  clientLlm: 5275,
  hub: 5276,
  hubWorker: 5278,
  site: 5280,
} as const;

export type E2EPortName = keyof typeof E2E_PORT_BASES;

/** Absolute directory containing durable checkout-to-offset records. */
export const E2E_PORT_ALLOCATION_DIR = join(homedir(), '.herdr', 'aikami', 'e2e-port-allocations');

const LOCK_FILE = '.allocation.lock';
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_STALE_MS = 30_000;
const PORT_PROBE_TIMEOUT_MS = 750;

/** One durable assignment. The checkout is stored in canonical form. */
export type PortAllocationRecord = {
  checkout: string;
  offset: number;
  allocatedAt: string;
};

/**
 * Filesystem/process seams for allocation. Tests provide an in-memory store;
 * production uses the durable implementation below.
 */
export type PortAllocationStore = {
  readRecords: (directory: string, slots?: number, step?: number) => PortAllocationRecord[];
  writeRecord: (directory: string, record: PortAllocationRecord) => void;
  withLock: <Result>(directory: string, action: () => Result) => Result;
  isPortAvailable: (port: number) => boolean;
  checkoutExists: (checkout: string) => boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isValidOffset = (offset: number, slots: number, step: number): boolean =>
  Number.isInteger(offset) && offset > 0 && offset <= slots * step && offset % step === 0;

const isValidAllocationRecord = (
  value: unknown,
  slots: number,
  step: number,
): value is PortAllocationRecord => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.checkout === 'string' &&
    value.checkout.length > 0 &&
    typeof value.offset === 'number' &&
    isValidOffset(value.offset, slots, step) &&
    typeof value.allocatedAt === 'string'
  );
};

/** Normalize a checkout path without requiring that a test fixture exists. */
export const canonicalizeCheckout = (checkout: string): string => {
  const absolute = resolve(checkout);
  return absolute.replace(/[\\/]+$/, '') || absolute;
};

/**
 * Find the repository root containing the current checkout. Walking from the
 * caller's cwd keeps imports correct whether the E2E task starts at the root or
 * in `apps/e2e`.
 */
export const findCheckoutRoot = (start: string = process.cwd()): string => {
  let current = resolve(start);
  for (;;) {
    if (existsSync(join(current, '.git')) || existsSync(join(current, 'bun.lock'))) {
      return current;
    }
    const parent = resolve(current, '..');
    if (parent === current) {
      return resolve(start);
    }
    current = parent;
  }
};

/** Linked Git worktrees have a `.git` file; the primary checkout has a directory. */
export const isLinkedWorktree = (checkout: string): boolean => {
  try {
    return statSync(join(checkout, '.git')).isFile();
  } catch {
    return false;
  }
};

/** Generate the non-zero offsets reserved for linked worktrees. */
export const portOffsetsForSlots = (
  slots: number = E2E_PORT_SLOTS,
  step: number = E2E_PORT_STEP,
): readonly number[] => {
  if (!Number.isInteger(slots) || slots <= 0) {
    throw new Error(`E2E port allocation requires a positive slot count, got ${slots}`);
  }
  if (!Number.isInteger(step) || step <= 0) {
    throw new Error(`E2E port allocation requires a positive step, got ${step}`);
  }
  return Object.freeze(Array.from({ length: slots }, (_, index) => (index + 1) * step));
};

/** The complete non-zero offset space for linked worktrees. */
export const E2E_PORT_OFFSETS = portOffsetsForSlots();

/** All service ports that move together for one checkout offset. */
export const portsForOffset = (
  offset: number,
  bases: Record<E2EPortName, number> = E2E_PORT_BASES,
): readonly number[] => Object.freeze(Object.values(bases).map((base) => base + offset));

/** Deterministic preferred slot in the circular probe order. */
export const preferredPortSlot = (checkout: string, slots: number = E2E_PORT_SLOTS): number => {
  if (!Number.isInteger(slots) || slots <= 0) {
    throw new Error(`E2E port allocation requires a positive slot count, got ${slots}`);
  }
  const digest = createHash('sha256').update(canonicalizeCheckout(checkout)).digest();
  return digest.readUInt32BE(0) % slots;
};

export type PortOffsetSelection = {
  checkout: string;
  slots?: number;
  step?: number;
  /** Offsets already reserved by another checkout record. */
  occupiedOffsets?: readonly number[];
  /** Optional pure availability predicate for the complete offset. */
  isAvailable?: (offset: number) => boolean;
};

/**
 * Select the first free slot in deterministic circular order.
 *
 * This function is deliberately pure: callers can exhaustively test collision
 * resolution without touching the filesystem or opening sockets.
 */
export const selectPortOffset = (options: PortOffsetSelection): number => {
  const slots = options.slots ?? E2E_PORT_SLOTS;
  const step = options.step ?? E2E_PORT_STEP;
  const offsets = portOffsetsForSlots(slots, step);
  const occupied = new Set(options.occupiedOffsets ?? []);
  const start = preferredPortSlot(options.checkout, slots);

  for (let index = 0; index < offsets.length; index += 1) {
    const offset = offsets[(start + index) % offsets.length];
    if (offset === undefined || occupied.has(offset)) {
      continue;
    }
    if (options.isAvailable && !options.isAvailable(offset)) {
      continue;
    }
    return offset;
  }

  throw new Error(
    `No E2E port offset available: all ${slots} slots (step ${step}) are occupied or busy.`,
  );
};

/** Compatibility alias with a descriptive name for callers outside this module. */
export const findAvailablePortOffset = selectPortOffset;

const allocationFileName = (checkout: string): string =>
  `${createHash('sha256').update(canonicalizeCheckout(checkout)).digest('hex')}.json`;

const readAllocationRecords = (
  directory: string,
  slots: number = E2E_PORT_SLOTS,
  step: number = E2E_PORT_STEP,
): PortAllocationRecord[] => {
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    return [];
  }

  const records: PortAllocationRecord[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) {
      continue;
    }
    try {
      const parsed = JSON.parse(readFileSync(join(directory, name), 'utf8')) as unknown;
      if (isValidAllocationRecord(parsed, slots, step)) {
        records.push({
          checkout: canonicalizeCheckout(parsed.checkout),
          offset: parsed.offset,
          allocatedAt: parsed.allocatedAt,
        });
      }
    } catch {
      // A torn or hand-edited record is not authority for a port assignment.
    }
  }
  return records;
};

const writeAllocationRecord = (directory: string, record: PortAllocationRecord): void => {
  mkdirSync(directory, { recursive: true });
  const target = join(directory, allocationFileName(record.checkout));
  const temporary = `${target}.${process.pid}.${randomBytes(5).toString('hex')}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(record, undefined, 2)}\n`, 'utf8');
    renameSync(temporary, target);
  } finally {
    if (existsSync(temporary)) {
      try {
        unlinkSync(temporary);
      } catch {
        // Best effort cleanup after a failed atomic write.
      }
    }
  }
};

const pidIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

const sleepSync = (milliseconds: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
};

const tryCreateAllocationLock = (options: {
  lockPath: string;
  token: string;
  now: () => number;
}): boolean => {
  let descriptor: number;
  try {
    descriptor = openSync(options.lockPath, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false;
    }
    throw error;
  }

  try {
    writeFileSync(
      descriptor,
      JSON.stringify({
        pid: process.pid,
        token: options.token,
        acquiredAt: new Date(options.now()).toISOString(),
      }),
      'utf8',
    );
    return true;
  } catch (error) {
    try {
      unlinkSync(options.lockPath);
    } catch {
      // Best effort cleanup after a failed lock write.
    }
    throw error;
  } finally {
    closeSync(descriptor);
  }
};

const isStaleAllocationLock = (lockPath: string, now: () => number): boolean => {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(lockPath).mtimeMs;
  } catch {
    return true;
  }
  try {
    const metadata = JSON.parse(readFileSync(lockPath, 'utf8')) as unknown;
    if (
      isRecord(metadata) &&
      typeof metadata.pid === 'number' &&
      Number.isInteger(metadata.pid) &&
      metadata.pid > 0 &&
      typeof metadata.token === 'string' &&
      metadata.token.length > 0 &&
      typeof metadata.acquiredAt === 'string' &&
      Number.isFinite(Date.parse(metadata.acquiredAt))
    ) {
      return !pidIsAlive(metadata.pid);
    }
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') {
      return true;
    }
    // A contender may still be writing metadata; use age for incomplete locks.
  }
  return mtimeMs < now() - LOCK_STALE_MS;
};

const removeAllocationLock = (lockPath: string): void => {
  try {
    unlinkSync(lockPath);
  } catch {
    // Another contender may have removed it first.
  }
};

const acquireAllocationLock = (options: {
  lockPath: string;
  token: string;
  now: () => number;
}): void => {
  const deadline = options.now() + LOCK_TIMEOUT_MS;
  while (!tryCreateAllocationLock(options)) {
    if (isStaleAllocationLock(options.lockPath, options.now)) {
      removeAllocationLock(options.lockPath);
      continue;
    }
    if (options.now() >= deadline) {
      throw new Error(`Timed out acquiring E2E port allocation lock at ${options.lockPath}`);
    }
    sleepSync(10);
  }
};

const releaseAllocationLock = (lockPath: string, token: string): void => {
  try {
    const metadata = JSON.parse(readFileSync(lockPath, 'utf8')) as unknown;
    if (isRecord(metadata) && metadata.token === token) {
      removeAllocationLock(lockPath);
    }
  } catch {
    // A completed allocation remains valid even if lock cleanup races EOF.
  }
};

const withAllocationLock = <Result>(
  directory: string,
  action: () => Result,
  now: () => number = Date.now,
): Result => {
  mkdirSync(directory, { recursive: true });
  const lockPath = join(directory, LOCK_FILE);
  const token = `${process.pid}-${now()}-${randomBytes(6).toString('hex')}`;
  acquireAllocationLock({ lockPath, token, now });
  try {
    return action();
  } finally {
    releaseAllocationLock(lockPath, token);
  }
};

/**
 * Synchronously test whether a TCP port can be bound. A child process is used
 * because Node's net API has no synchronous connect/listen primitive. Failure
 * to probe is treated as busy (fail closed), never as permission to collide.
 */
export const isPortAvailableSync = (port: number): boolean => {
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    return false;
  }
  const script = [
    "const net = require('node:net');",
    'const port = Number(process.env.AIKAMI_E2E_PORT_PROBE);',
    'const server = net.createServer();',
    'let finished = false;',
    'const finish = (value) => { if (finished) return; finished = true; clearTimeout(timer); server.close(() => process.stdout.write(value)); };',
    "server.once('error', () => finish('busy'));",
    "server.listen({ host: '0.0.0.0', port }, () => finish('free'));",
    'const timer = setTimeout(() => finish("busy"), 500);',
  ].join('');
  const result = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    timeout: PORT_PROBE_TIMEOUT_MS,
    env: { ...process.env, AIKAMI_E2E_PORT_PROBE: String(port) },
  });
  return result.status === 0 && result.stdout.trim() === 'free';
};

/** Acquire the same filesystem lock used by allocation (exported for tests/tools). */
export const withPortAllocationLock = withAllocationLock;

const defaultStore: PortAllocationStore = {
  readRecords: readAllocationRecords,
  writeRecord: writeAllocationRecord,
  withLock: withAllocationLock,
  isPortAvailable: isPortAvailableSync,
  checkoutExists: (checkout) => existsSync(join(checkout, '.git')),
};

export type PortAllocationOptions = {
  checkout: string;
  allocationDir?: string;
  store?: Partial<PortAllocationStore>;
  slots?: number;
  step?: number;
  /** Override the store's per-port probe in tests or specialized launchers. */
  isPortAvailable?: (port: number) => boolean;
  /** Override allocation timestamps in deterministic tests. */
  now?: () => number;
};

/**
 * Allocate (or recover) the durable offset for a linked checkout.
 *
 * Existing records win, which makes repeated E2E runs stable. New records are
 * selected under the cross-process lock, skipping both recorded offsets and
 * offsets whose complete service port set cannot be bound.
 */
export const allocatePortOffset = (options: PortAllocationOptions): number => {
  const slots = options.slots ?? E2E_PORT_SLOTS;
  const step = options.step ?? E2E_PORT_STEP;
  const directory = options.allocationDir ?? E2E_PORT_ALLOCATION_DIR;
  const checkout = canonicalizeCheckout(options.checkout);
  const store: PortAllocationStore = {
    ...defaultStore,
    ...options.store,
  };
  const isPortAvailable = options.isPortAvailable ?? store.isPortAvailable;

  return store.withLock(directory, () => {
    const records = store.readRecords(directory, slots, step);
    const existing = records.find((record) => record.checkout === checkout);
    const occupied = new Set(
      records
        .filter((record) => record.checkout !== checkout && store.checkoutExists(record.checkout))
        .map((record) => record.offset),
    );
    const validOffsets = new Set(portOffsetsForSlots(slots, step));

    if (existing && validOffsets.has(existing.offset) && !occupied.has(existing.offset)) {
      return existing.offset;
    }

    const offset = selectPortOffset({
      checkout,
      slots,
      step,
      occupiedOffsets: [...occupied],
      isAvailable: (candidate) => portsForOffset(candidate).every((port) => isPortAvailable(port)),
    });
    store.writeRecord(directory, {
      checkout,
      offset,
      allocatedAt: new Date((options.now ?? Date.now)()).toISOString(),
    });
    return offset;
  });
};

export type ResolvePortOffsetOptions = {
  env?: Record<string, string | undefined>;
  cwd?: string;
  checkoutRoot?: string;
  allocationDir?: string;
  store?: Partial<PortAllocationStore>;
  isLinkedWorktree?: (checkout: string) => boolean;
  isPortAvailable?: (port: number) => boolean;
  now?: () => number;
  /** Permit an explicit zero for a linked checkout when the caller owns it. */
  allowExplicitZero?: boolean;
};

/** Parse the explicit public override without silently accepting NaN. */
export const parseExplicitPortOffset = (value: string | undefined): number | undefined => {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`PUBLIC_EMULATOR_PORT_OFFSET must be a non-negative integer, got "${value}"`);
  }
  return parsed;
};

/**
 * Resolve the offset used by every E2E consumer.
 *
 * A non-zero explicit environment value is authoritative. An inherited zero is
 * not: a root/Herdr shell can export `PUBLIC_EMULATOR_PORT_OFFSET=0` before a
 * linked worktree launches, which would otherwise bypass its durable checkout
 * allocation and collide with the root checkout. Callers that intentionally own
 * an explicit zero for a linked checkout must opt in with `allowExplicitZero`.
 * Otherwise the primary checkout stays on offset zero and only a linked
 * worktree consults the durable allocator.
 */
export const resolveE2EPortOffset = (options: ResolvePortOffsetOptions = {}): number => {
  const environment = options.env ?? process.env;
  const explicit = parseExplicitPortOffset(environment.PUBLIC_EMULATOR_PORT_OFFSET);
  if (explicit !== undefined && explicit !== 0) {
    return explicit;
  }

  const checkoutRoot = canonicalizeCheckout(options.checkoutRoot ?? findCheckoutRoot(options.cwd));
  const linked = options.isLinkedWorktree ?? isLinkedWorktree;
  const isLinked = linked(checkoutRoot);
  if (explicit === 0 && (!isLinked || options.allowExplicitZero === true)) {
    return 0;
  }
  if (!isLinked) {
    return 0;
  }

  return allocatePortOffset({
    checkout: checkoutRoot,
    ...(options.allocationDir !== undefined ? { allocationDir: options.allocationDir } : {}),
    ...(options.store !== undefined ? { store: options.store } : {}),
    ...(options.isPortAvailable !== undefined ? { isPortAvailable: options.isPortAvailable } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
};

/** Descriptive alias used by config consumers. */
export const getE2EPortOffset = resolveE2EPortOffset;

/** Descriptive alias for callers that want to make allocation explicit. */
export const allocateE2EPortOffset = allocatePortOffset;
