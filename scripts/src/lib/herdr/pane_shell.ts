// scripts/src/lib/herdr/pane_shell.ts
//
// Shell-aware command wrapping for herdr panes. Extracted from `session.ts`
// (size ratchet) — this is a cohesive quoting/transport kernel with no Herdr
// RPC of its own.
//
// 🔴 herdr panes do not all run bash. On Windows they default to the user's
// shell (PowerShell here), whose native-arg mangling corrupts `bash -c "…"`.
// Each shell therefore gets its own transport, documented on `wrapCommand`.

import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasDirenv } from '../env/direnv_detect';
import { findBash, posixQuote } from '../env/which';

/** Keeps a crashed service's output on screen instead of closing the pane. */
const PANE_TRAILER = '=== Stopped. Press Enter to close ===';

/**
 * The shell a herdr pane runs — governs how a command string must be quoted
 * before `pane run` sends it to the pane's PTY.
 */
export type PaneShell = 'powershell' | 'nushell' | 'cmd' | 'posix';

/**
 * Map a pane's foreground process name to the shell kind it represents.
 * herdr launches panes with the user's configured default shell — on this
 * Windows install that is `powershell.exe` (the old "panes default to
 * Nushell" comment predates herdr 0.8.0-preview).
 */
export const paneShellFromProcessName = (name: string): PaneShell => {
  const n = name.toLowerCase().replace(/\.exe$/, '');
  if (n.includes('powershell') || n.includes('pwsh')) {
    return 'powershell';
  }
  if (n === 'cmd' || n.includes('cmd')) {
    return 'cmd';
  }
  if (n === 'nu' || n === 'nushell' || n.includes('nu')) {
    return 'nushell';
  }
  return 'posix';
};

/**
 * Quote a value for a PowerShell single-quoted string: `'` → `''`.
 * PowerShell has no POSIX `'\''` escape; doubling is the single-quote escape.
 */
export const psQuote = (value: string): string => `'${value.replaceAll("'", "''")}'`;

/**
 * Quote a value as a CMD double-quoted argument, escaping embedded `"` as
 * `\"` (cmd.exe has no literal-quote escape inside a `"…"` token; `\"` is
 * the accepted convention for native args). Used for `cmd` panes, which
 * treat POSIX single quotes as literals.
 */
export const cmdQuote = (value: string): string => `"${value.replaceAll('"', '\\"')}"`;

/**
 * Write `script` to a unique temp .sh file and return its path. Used for
 * PowerShell panes, where passing `-c <script>` through PowerShell's native
 * arg mangling (embedded `"` becomes `\"` in the command line) corrupts the
 * script. A file avoids the `-c` boundary entirely: only two quoted paths
 * cross the shell.
 */
const writeTempBashScript = (script: string): string => {
  const path = join(
    tmpdir(),
    `herdr-pane-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`,
  );
  writeFileSync(path, script, 'utf-8');
  return path;
};

/**
 * Wraps a command for a herdr pane, in descending order of fidelity:
 *
 *   1. bash + direnv — `direnv exec .` loads the flake devShell (bun, jdk,
 *      chromium … from flake.nix) before running the command.
 *   2. bash, no direnv — on a machine without direnv (Windows without
 *      WSL+Nix, per `bun run setup`'s recommended-path check) the prefix is
 *      not a harmless no-op, it's a "command not found" that kills the pane
 *      before the real command runs. Drop it; the caller owns their PATH/env
 *      (manual tool installs, MOON_TOOLCHAIN_FORCE_GLOBALS, .env.local).
 *   3. Windows without bash — `cmd /c "… & pause"`. cmd.exe is always
 *      present, and `pause` gives the same keep-the-pane-open behavior.
 *   4. Anything else — run bare in the pane's own shell. The pane closes on
 *      exit, but the command still runs.
 *
 * `bash` is passed as an absolute path (see `findBash`) because herdr panes
 * default to the user's shell on Windows (PowerShell here), whose PATH does
 * not include Git's bash.
 *
 * PowerShell panes get `& 'bash' 'script.sh'` with the script in a temp
 * file — PowerShell rejects the POSIX `'bash' -c '…'` form (parse error at
 * `-c`) and mangles embedded `"` in native args, so a file is the only
 * reliable transport. With direnv, both the PowerShell and CMD forms route
 * through `direnv exec .` so the pane still gets the flake devShell env.
 * CMD panes invoke the temp script with double-quoted args (`cmd.exe` treats
 * single quotes as literals); the keep-open trailer is preserved in all
 * bash-backed forms.
 */
export const wrapCommand = (command: string, shell: PaneShell = 'posix'): string => {
  const bash = findBash();
  if (bash) {
    const script = `${command}; echo; echo "${PANE_TRAILER}"; read`;
    if (shell === 'powershell') {
      const scriptPath = writeTempBashScript(`#!/usr/bin/env bash\n${script}\n`);
      // With direnv, route through `direnv exec .` so the pane gets the flake
      // devShell env; the `&` call operator is only valid as the first token,
      // so it is dropped in the direnv form.
      if (hasDirenv()) {
        return `direnv exec . ${psQuote(bash)} ${psQuote(scriptPath)}`;
      }
      return `& ${psQuote(bash)} ${psQuote(scriptPath)}`;
    }
    if (shell === 'cmd') {
      // cmd.exe treats single quotes as literals, so the POSIX `-c '…'` form
      // would pass the script text as one literal arg and fail. Use the same
      // temp-script transport as PowerShell, invoked with CMD-compatible
      // double-quote escaping. direnv exec is retained for the direnv case,
      // matching the POSIX path.
      const scriptPath = writeTempBashScript(`#!/usr/bin/env bash\n${script}\n`);
      const invocation = `${cmdQuote(bash)} ${cmdQuote(scriptPath)}`;
      return hasDirenv() ? `direnv exec . ${invocation}` : invocation;
    }
    // Quoted so a Windows path like `C:\Program Files\Git\bin\bash.exe`
    // survives the pane shell's tokenizing — unquoted, the space in "Program
    // Files" would split it into two args.
    const prefix = hasDirenv() ? `direnv exec . ${posixQuote(bash)} -c` : `${posixQuote(bash)} -c`;
    return `${prefix} ${posixQuote(script)}`;
  }

  // cmd.exe has no escape for a literal `"` inside a `/c "…"` string, so only
  // take this path when the command has none (every SERVICE_DEFS command
  // does). Otherwise fall through to running it bare.
  if (process.platform === 'win32' && !command.includes('"')) {
    return `cmd /c "${command} & pause"`;
  }

  return command;
};

/**
 * Run a raw bash script in a pane, shell-aware. Same PowerShell-vs-POSIX
 * split as {@link wrapCommand}: PowerShell gets a temp script file invoked
 * via `& 'bash' 'file'` (its native-arg `"` mangling corrupts `-c`), other
 * shells get `'bash' -c '<script>'`.
 */
export const bashScriptForPane = async (shell: PaneShell, script: string): Promise<string> => {
  const bash = findBash();
  if (!bash) {
    return script;
  }
  if (shell === 'powershell') {
    const scriptPath = writeTempBashScript(`#!/usr/bin/env bash\n${script}\n`);
    return `& ${psQuote(bash)} ${psQuote(scriptPath)}`;
  }
  return `${posixQuote(bash)} -c ${posixQuote(script)}`;
};
