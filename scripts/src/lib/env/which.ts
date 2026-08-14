// scripts/src/lib/env/which.ts
/**
 * Runtime-agnostic, cross-platform executable lookup.
 *
 * 🔴 WHY THIS EXISTS — `Bun.which` is a trap in this repo.
 *
 * Half of scripts/src/lib is dual-runtime: `bun run herdr:start` executes it
 * under Bun, but `.pi/extensions/*.ts` import the SAME modules and pi always
 * runs under Node (its bin has a `#!/usr/bin/env node` shebang — the
 * `npmCommand: ["bun"]` setting in .pi/settings.json only chooses the package
 * *installer*, not the runtime). A bare `Bun.which(...)` therefore throws
 * `ReferenceError: Bun is not defined` the moment a pi extension reaches that
 * line — regardless of bun being installed globally and on PATH.
 *
 * The fix is not a `typeof Bun !== 'undefined'` guard (that leaves two code
 * paths with different behavior); it's one pure-Node implementation that both
 * runtimes execute identically. Bun implements all of node:fs and node:path,
 * so there is nothing to gain from branching.
 *
 * Windows correctness (Bun.which does NOT do this for you):
 *   - PATHEXT probing, so `which('bun')` finds `bun.exe` / `git.cmd`
 *   - no X_OK check — the executable bit is meaningless on Windows and
 *     `accessSync(X_OK)` succeeds for every readable file there
 */

import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

const isWindows = process.platform === 'win32';

/** Executable suffixes to try on Windows, in PATHEXT order. */
const pathExtensions = (): string[] =>
  isWindows
    ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
        .split(';')
        .map((ext) => ext.trim())
        .filter(Boolean)
    : [''];

/** True when `candidate` exists and is runnable as a program. */
const isExecutableFile = (candidate: string): boolean => {
  try {
    if (!statSync(candidate).isFile()) {
      return false;
    }
    if (isWindows) {
      // No executable bit on Windows — existence with a PATHEXT suffix is it.
      return true;
    }
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * Absolute path of `bin` as resolved from PATH, or `null` when not found.
 * Drop-in replacement for `Bun.which` that also works under Node and on
 * Windows. Not cached — callers that run this in a loop should cache.
 */
export const which = (bin: string): string | null => {
  const extensions = pathExtensions();
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) {
      continue;
    }
    for (const ext of extensions) {
      // A name that already carries its suffix (`bash.exe`) must still match:
      // '' is never in `extensions` on Windows, so probe the bare name too.
      const candidate = join(dir, bin + ext);
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
    if (isWindows && isExecutableFile(join(dir, bin))) {
      return join(dir, bin);
    }
  }
  return null;
};

let _bashPath: string | null | undefined;

/**
 * Absolute path to a `bash` we can hand to a herdr pane, or `null`.
 *
 * Resolved from OUR process's PATH rather than left as a bare `bash` for the
 * pane's shell to look up: herdr panes default to Nushell on Windows, whose
 * PATH does not include Git's `usr\bin`, so a bare `bash` there fails with
 * "Command `bash` not found" even though bash is installed and on our PATH.
 *
 * Windows fallback via git: Git for Windows puts only `…\Git\cmd` on PATH
 * (git.exe, gitk.exe) — `bash.exe` lives one directory over in `…\Git\bin`
 * and is normally NOT on PATH. So when the direct lookup misses, derive it
 * from git's own location. Cached; neither PATH nor the binary is expected
 * to change mid-process.
 */
export const findBash = (): string | null => {
  if (_bashPath !== undefined) {
    return _bashPath;
  }
  const direct = which('bash');
  if (direct) {
    _bashPath = direct;
    return _bashPath;
  }
  const git = which('git');
  if (git) {
    // …\Git\cmd\git.exe → …\Git\bin\bash.exe, and the usr\bin sibling that
    // some portable installs use instead.
    const gitRoot = dirname(dirname(git));
    for (const rel of [
      join('bin', 'bash.exe'),
      join('usr', 'bin', 'bash.exe'),
      join('bin', 'bash'),
    ]) {
      const candidate = join(gitRoot, rel);
      if (existsSync(candidate)) {
        _bashPath = candidate;
        return _bashPath;
      }
    }
  }
  _bashPath = null;
  return _bashPath;
};

/** Reset the `findBash` cache. Test-only. */
export const resetBashCache = (): void => {
  _bashPath = undefined;
};

/**
 * Quote a string as a single POSIX shell argument.
 * `it's` → `'it'\''s'`. Safe for arbitrary content, unlike a bare `'${x}'`.
 */
export const posixQuote = (value: string): string => `'${value.replaceAll("'", String.raw`'\''`)}'`;
