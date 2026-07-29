// scripts/src/lib/cli_utils.ts
/**
 * Shared CLI utilities for Aikami scripts.
 *
 * Common patterns: colored output, prompts, command execution.
 */

// ============================================================================
// ANSI Colours
// ============================================================================

export const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  white: '\x1b[37m',
  magenta: '\x1b[35m',
};

export const log = (msg: string) => console.log(`${c.cyan}▶${c.reset} ${msg}`);
export const ok = (msg: string) => console.log(`${c.green}✓${c.reset} ${msg}`);
export const warn = (msg: string) => console.log(`${c.yellow}!${c.reset} ${msg}`);
export const error = (msg: string) => console.log(`${c.red}✗${c.reset} ${msg}`);
export const info = (msg: string) => console.log(`${c.dim}•${c.reset} ${msg}`);
export const fail = (msg: string) => console.log(`${c.red}✗${c.reset} ${msg}`);
export const step = (label: string) => console.log(`\n${c.blue}${c.bold}▶ ${label}${c.reset}`);

// ============================================================================
// CLI Arguments
// ============================================================================

export const getArg = (args: string[], name: string): string | undefined => {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=') : undefined;
};

export const hasFlag = (args: string[], name: string): boolean => args.includes(`--${name}`);

/**
 * Get the value after a `--flag value` pair (not `--flag=value`).
 */
export const parseArg = (args: string[], flag: string): string | undefined => {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
};

// ============================================================================
// Command Execution
// ============================================================================

export type RunResult = { out: string; err: string; code: number };

/**
 * Run a shell command, capturing stdout/stderr.
 */
export const run = async (cmd: string[]): Promise<RunResult> => {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' });
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  const code = await proc.exited;
  return { out: out.trim(), err: err.trim(), code };
};

/**
 * Run a shell command, streaming output to the console.
 * Returns the exit code.
 */
export const runStream = async (
  cmd: string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
): Promise<number> => {
  const proc = Bun.spawn(cmd, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return proc.exited;
};

/**
 * Spawn a labeled command, printing a running message and result.
 * Returns the exit code.
 */
export const spawnLabeled = async (
  cmd: string[],
  label: string,
  options: { cwd?: string } = {},
): Promise<number> => {
  info(`Running: ${cmd.join(' ')}`);
  const proc = Bun.spawn({ cmd, cwd: options.cwd, stdout: 'inherit', stderr: 'inherit' });
  const code = await proc.exited;
  if (code === 0) {
    ok(`${label} — exit 0`);
  } else {
    error(`${label} — exit ${code}`);
  }
  return code;
};

/**
 * Run a command with a step label, printing a heading and result.
 * Returns true if successful.
 */
export const runChecked = async (label: string, cmd: string[]): Promise<boolean> => {
  step(label);
  const proc = Bun.spawn({ cmd, stdout: 'inherit', stderr: 'inherit' });
  const exitCode = await proc.exited;
  if (exitCode === 0) {
    ok(label);
    return true;
  }
  fail(`${label} (exit code ${exitCode})`);
  return false;
};

// ============================================================================
// Misc
// ============================================================================

/**
 * Print an ASCII banner.
 */
export const banner = (title: string): void => {
  const width = 51;
  const padded = title.padEnd(width - 2);
  console.log(`${c.bold}
╔${'═'.repeat(width)}╗
║  ${padded}║
╚${'═'.repeat(width)}╝${c.reset}\n`);
};
