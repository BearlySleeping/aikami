// apps/backend/local-stack/stack/generation/flock.ts
//
// Crash-safe exclusive file locking for the generation job store.
//
// Lock authority is an OS advisory `flock` held by an open file descriptor:
// process death releases it in the kernel, so recovery never has to delete or
// replace a pathname another process may have acquired in the meantime.
//
// 🔴 Ported from `@bearly/flock@0.1.0` (MIT License, © Bjørn Stabell —
// https://github.com/beorn/bearly, see there for the full license text) so the
// host owns the exact primitive it uses to serialize its own job store instead
// of relying on an external install. Supports Bun on local macOS and Linux
// filesystems, matching the upstream contract; any other platform throws on
// first use.

import type { FFIFunction, Library, Pointer } from 'bun:ffi';
import { dlopen, FFIType, read } from 'bun:ffi';
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  writeSync,
} from 'node:fs';
import { dirname } from 'node:path';

/** `LOCK_EX` from `<sys/file.h>` — a single exclusive owner. */
const LOCK_EX = 2;

/** `LOCK_NB` from `<sys/file.h>` — fail instead of blocking. */
const LOCK_NB = 4;

/** `EINTR` — the syscall was interrupted before it completed. */
const INTERRUPTED_ERRNO = 4;

/** Options for acquiring a lock. */
export type FlockOpenOptions = {
  /** Diagnostics written to the lock file once it is held. */
  readonly body?: string | Uint8Array;
  /** Mode for the lock file; defaults to `0o600`. */
  readonly fileMode?: number;
  /** Create the parent directory when absent; defaults to `true`. */
  readonly createParent?: boolean;
  /** Mode for a newly created parent directory; defaults to `0o700`. */
  readonly parentMode?: number;
};

/** A live exclusive lock; closing the descriptor is the release. */
export type FlockHandle = {
  readonly path: string;
  readonly fd: number;
  /** Local handle state only; an inherited duplicate may still own the lock. */
  readonly held: boolean;
  /** Replaces the diagnostics body; fsynced on success, closes on failure. */
  replaceBody(body: string | Uint8Array): void;
  /** Closes only. Never issues `LOCK_UN` because another process may own a duplicate fd. */
  release(): void;
  [Symbol.dispose](): void;
};

/** Result of one `flock` syscall. */
type FlockResult = { readonly ok: true } | { readonly ok: false; readonly errno: number };

/** The syscall surface the portable runtime depends on. */
type FlockIo = {
  createParent(path: string, mode: number): void;
  exists(path: string): boolean;
  open(path: string, mode: number): number;
  identity(fd: number): string;
  flock(fd: number, mode: 'try' | 'block'): FlockResult;
  truncate(fd: number): void;
  write(fd: number, bytes: Uint8Array, offset: number, length: number): number;
  fsync(fd: number): void;
  close(fd: number): void;
};

/** Runtime knobs plus the IO surface they drive. */
type FlockRuntimeOptions = {
  readonly wouldBlockErrnos: readonly number[];
  readonly interruptedErrno: number;
  readonly io: FlockIo;
};

/** An open descriptor plus the identity that de-duplicates it within this process. */
type FlockCandidate = {
  readonly fd: number;
  readonly identity: string;
  readonly path: string;
};

/** The portable lock operations, over an injected IO surface. */
type FlockRuntime = {
  tryAcquire(path: string, options?: FlockOpenOptions): FlockHandle | undefined;
  acquireBlocking(path: string, options?: FlockOpenOptions): FlockHandle;
  isHeld(path: string): boolean;
};

/** Ordered libc locations to try for each supported platform. */
const libcCandidates = (platform: string): readonly string[] => {
  if (platform === 'darwin') {
    return ['/usr/lib/libSystem.B.dylib', 'libSystem.B.dylib', 'libc.dylib'];
  }
  if (platform === 'linux') {
    return ['libc.so.6', 'libc.so'];
  }
  return [];
};

/** Opens the first libc candidate that resolves the requested symbols. */
const openFirst = <TFns extends Record<string, FFIFunction>>(
  platform: string,
  definition: TFns,
): Library<TFns> => {
  const failures: string[] = [];
  for (const candidate of libcCandidates(platform)) {
    try {
      return dlopen(candidate, definition);
    } catch (error) {
      failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`flock could not load libc; tried ${failures.join('; ')}`);
};

/** Reads `errno` behind a platform accessor, rejecting the null pointer Bun's types allow. */
const readErrno = (pointer: Pointer | bigint | null): number => {
  if (pointer === null) {
    throw new Error('flock could not read errno: the platform returned a null pointer');
  }
  return read.i32(pointer);
};

/** Loads the platform's `flock` symbol and its errno accessor. */
const loadFlock = (platform: string): ((fd: number, operation: number) => FlockResult) => {
  if (platform === 'linux') {
    const library = openFirst(platform, {
      flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
      // biome-ignore lint/style/useNamingConvention: libc symbol — must match <errno.h> exactly.
      __errno_location: { args: [], returns: FFIType.ptr },
    });
    return (fd, operation) =>
      library.symbols.flock(fd, operation) === 0
        ? { ok: true }
        : { ok: false, errno: readErrno(library.symbols.__errno_location()) };
  }
  if (platform === 'darwin') {
    const library = openFirst(platform, {
      flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
      __error: { args: [], returns: FFIType.ptr },
    });
    return (fd, operation) =>
      library.symbols.flock(fd, operation) === 0
        ? { ok: true }
        : { ok: false, errno: readErrno(library.symbols.__error()) };
  }
  throw new Error(
    `flock supports Bun on local macOS and Linux filesystems; unsupported platform: ${platform}`,
  );
};

/** Builds the Bun/FFI IO surface for the current platform. */
const createNativeFlockRuntime = (platform: string = process.platform): FlockRuntimeOptions => {
  const callFlock = loadFlock(platform);
  return {
    wouldBlockErrnos: platform === 'darwin' ? [35] : [11],
    interruptedErrno: INTERRUPTED_ERRNO,
    io: {
      createParent: (path, mode) => {
        mkdirSync(dirname(path), { recursive: true, mode });
      },
      exists: existsSync,
      open: (path, mode) => openSync(path, 'a+', mode),
      identity: (fd) => {
        const stat = fstatSync(fd, { bigint: true });
        return `${String(stat.dev)}:${String(stat.ino)}`;
      },
      flock: (fd, mode) => callFlock(fd, LOCK_EX | (mode === 'try' ? LOCK_NB : 0)),
      truncate: (fd) => ftruncateSync(fd, 0),
      write: (fd, bytes, offset, length) => writeSync(fd, bytes, offset, length),
      fsync: fsyncSync,
      close: closeSync,
    },
  };
};

/** Closes a half-open descriptor and rethrows the original failure. */
const closeAfterFailure = (io: FlockIo, fd: number, error: unknown): never => {
  try {
    io.close(fd);
  } catch (closeError) {
    throw new AggregateError([error, closeError], 'flock setup and close both failed');
  }
  throw error;
};

/** Runs one flock syscall, closing the descriptor if the syscall itself throws. */
const flockOrClose = (io: FlockIo, fd: number, mode: 'try' | 'block'): FlockResult => {
  try {
    return io.flock(fd, mode);
  } catch (error) {
    return closeAfterFailure(io, fd, error);
  }
};

/** Builds the errno-carrying error for a failed flock syscall. */
const flockError = (path: string, errno: number): Error =>
  Object.assign(new Error(`flock syscall failed: errno=${errno} path=${path}`), {
    code: `ERRNO_${errno}`,
    errno,
    syscall: 'flock',
    path,
  });

/** Writes the whole diagnostics body, then fsyncs it. */
const writeCompleteBody = (
  io: FlockIo,
  fd: number,
  body: string | Uint8Array,
  path: string,
): void => {
  const bytes = typeof body === 'string' ? Buffer.from(body) : body;
  io.truncate(fd);
  let offset = 0;
  while (offset < bytes.length) {
    const written = io.write(fd, bytes, offset, bytes.length - offset);
    if (written <= 0) {
      throw new Error(`flock diagnostics write made no progress: ${path}`);
    }
    if (written > bytes.length - offset) {
      throw new Error(`flock diagnostics write exceeded the requested byte count: ${path}`);
    }
    offset += written;
  }
  io.fsync(fd);
};

/** Opens a descriptor for `path` and captures the identity used for de-duplication. */
const openCandidate = (io: FlockIo, path: string, options: FlockOpenOptions): FlockCandidate => {
  if (options.createParent !== false) {
    io.createParent(path, options.parentMode ?? 0o700);
  }
  const fd = io.open(path, options.fileMode ?? 0o600);
  try {
    return { fd, identity: io.identity(fd), path };
  } catch (error) {
    return closeAfterFailure(io, fd, error);
  }
};

/** Publishes a held lock and wires its release path to the open descriptor. */
const publishHandle = (
  io: FlockIo,
  heldIdentities: Set<string>,
  candidate: FlockCandidate,
  initialBody: string | Uint8Array | undefined,
): FlockHandle => {
  heldIdentities.add(candidate.identity);
  let released = false;
  const release = (): void => {
    if (released) {
      return;
    }
    io.close(candidate.fd);
    released = true;
    heldIdentities.delete(candidate.identity);
  };
  const replaceBody = (body: string | Uint8Array): void => {
    if (released) {
      throw new Error(`cannot replace diagnostics on a released flock: ${candidate.path}`);
    }
    try {
      writeCompleteBody(io, candidate.fd, body, candidate.path);
    } catch (error) {
      try {
        release();
      } catch (closeError) {
        throw new AggregateError(
          [error, closeError],
          `flock diagnostics and close both failed: ${candidate.path}`,
        );
      }
      throw error;
    }
  };
  const handle: FlockHandle = {
    path: candidate.path,
    fd: candidate.fd,
    get held(): boolean {
      return !released;
    },
    replaceBody,
    release,
    [Symbol.dispose]: () => {
      release();
    },
  };
  if (initialBody !== undefined) {
    replaceBody(initialBody);
  }
  return handle;
};

/** Builds the portable flock runtime over an injected IO surface. */
const createFlockRuntime = (io: FlockIo, options: FlockRuntimeOptions): FlockRuntime => {
  const heldIdentities = new Set<string>();

  return {
    tryAcquire: (path, openOptions = {}) => {
      const candidate = openCandidate(io, path, openOptions);
      if (heldIdentities.has(candidate.identity)) {
        io.close(candidate.fd);
        return undefined;
      }
      const result = flockOrClose(io, candidate.fd, 'try');
      if (!result.ok) {
        io.close(candidate.fd);
        if (options.wouldBlockErrnos.includes(result.errno)) {
          return undefined;
        }
        throw flockError(path, result.errno);
      }
      return publishHandle(io, heldIdentities, candidate, openOptions.body);
    },
    acquireBlocking: (path, openOptions = {}) => {
      const candidate = openCandidate(io, path, openOptions);
      if (heldIdentities.has(candidate.identity)) {
        io.close(candidate.fd);
        throw new Error(`flock already held by this process: ${path}`);
      }
      for (;;) {
        const result = flockOrClose(io, candidate.fd, 'block');
        if (result.ok) {
          break;
        }
        if (result.errno === options.interruptedErrno) {
          continue;
        }
        io.close(candidate.fd);
        throw flockError(path, result.errno);
      }
      return publishHandle(io, heldIdentities, candidate, openOptions.body);
    },
    isHeld: (path) => {
      if (!io.exists(path)) {
        return false;
      }
      const candidate = openCandidate(io, path, { createParent: false });
      if (heldIdentities.has(candidate.identity)) {
        io.close(candidate.fd);
        return true;
      }
      const result = flockOrClose(io, candidate.fd, 'try');
      io.close(candidate.fd);
      if (result.ok) {
        return false;
      }
      if (options.wouldBlockErrnos.includes(result.errno)) {
        return true;
      }
      throw flockError(path, result.errno);
    },
  };
};

const native = createNativeFlockRuntime();
const runtime = createFlockRuntime(native.io, native);

/** Tries one exclusive fd-held flock; returns `undefined` only when a live owner holds it. */
export const tryAcquireFlock = (
  path: string,
  options?: FlockOpenOptions,
): FlockHandle | undefined => runtime.tryAcquire(path, options);

/** Blocks in the kernel until one exclusive fd-held flock is acquired. */
export const acquireFlockBlocking = (path: string, options?: FlockOpenOptions): FlockHandle =>
  runtime.acquireBlocking(path, options);

/** Observes flock liveness; durable pathname/body presence is never authority. */
export const isFlockHeld = (path: string): boolean => runtime.isHeld(path);
