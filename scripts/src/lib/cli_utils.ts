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

/**
 * Colored formatting helpers for setup script output.
 * All keys return a string (caller must console.log it).
 */
export const fmt = {
  ok: (s: string) => `${c.green}✓${c.reset} ${s}`,
  warn: (s: string) => `${c.yellow}!${c.reset} ${s}`,
  err: (s: string) => `${c.red}✗${c.reset} ${s}`,
  fix: (s: string) => `${c.cyan}→${c.reset} ${s}`,
  head: (s: string) => `\n${c.bold}${c.white}${s}${c.reset}`,
  note: (s: string) => `     ${c.dim}${s}${c.reset}`,
  section: (s: string) => `\n${c.bold}${c.cyan}── ${s} ──${c.reset}`,
  cmd: (s: string) => `     ${c.dim}${s}${c.reset}`,
  url: (s: string) => `     ${c.magenta}${s}${c.reset}`,
  step: (n: number, s: string) => `  ${c.bold}${c.blue}${n}.${c.reset} ${s}`,
};

/** Globally suppress non-essential output. Set via --quiet flag. */
let _logQuiet = false;
export const setLogQuiet = (v: boolean) => {
  _logQuiet = v;
};
export const isLogQuiet = () => _logQuiet;

export const log = (msg: string) => {
  if (!_logQuiet) {
    console.log(`${c.cyan}▶${c.reset} ${msg}`);
  }
};
export const ok = (msg: string) => console.log(`${c.green}✓${c.reset} ${msg}`);
export const warn = (msg: string) => console.log(`${c.yellow}!${c.reset} ${msg}`);
export const error = (msg: string) => console.log(`${c.red}✗${c.reset} ${msg}`);
export const info = (msg: string) => console.log(`${c.dim}•${c.reset} ${msg}`);
export const fail = (msg: string) => console.log(`${c.red}✗${c.reset} ${msg}`);
export const step = (label: string) => console.log(`\n${c.blue}${c.bold}▶ ${label}${c.reset}`);

// ============================================================================
// CLI Arguments
// ============================================================================

/** Schema for a single CLI option. */
export type CliOption = {
  type?: 'string' | 'boolean';
  /** Short aliases (without leading dash). e.g. ['m'] for `-m`. */
  aliases?: string[];
  /** Map abbreviated values to canonical form. e.g. `{ prod: 'production' }`. */
  map?: Record<string, string>;
};

/** Parsed result — values by name, plus positionals in `_`. */
export type CliResult<T extends Record<string, CliOption>> = {
  [K in keyof T]: T[K] extends { type: 'boolean' } ? boolean : string | undefined;
} & { _: string[] };

/**
 * Parse CLI arguments in a single pass. Handles:
 *   - `--flag`              → boolean true
 *   - `--no-flag`           → boolean false (negation always uses `--no-`)
 *   - `--key=value`         → string
 *   - `--key value`         → string (value must not start with `-`)
 *   - `--key prod`          → mapped via `map: { prod: 'production' }`
 *   - `-f`                  → short alias (must be in `aliases`)
 *   - `-f value` / `-f=value` → alias with value
 *
 * Unknown flags are silently collected as positionals.
 * Positional arguments (non-flag) go into `_`.
 *
 * @example
 *   const opts = parseCliArgs(Bun.argv.slice(2), {
 *     mode:  { type: 'string', aliases: ['m'], map: { prod: 'production' } },
 *     force: { type: 'boolean', aliases: ['f'] },
 *     'dry-run': { type: 'boolean' },
 *   });
 *   // opts.mode === 'production'
 *   // opts.force === true
 *   // opts._ === ['client']
 */
export function parseCliArgs<T extends Record<string, CliOption>>(
  rawArgs: string[],
  schema: T,
): CliResult<T> {
  // Build lookup: flag name → normalized key + option def
  const flagMap = new Map<string, { key: string; opt: CliOption }>();
  for (const [key, opt] of Object.entries(schema)) {
    flagMap.set(`--${key}`, { key, opt });
    // negation for boolean flags
    if (opt.type === 'boolean' || !opt.type) {
      flagMap.set(`--no-${key}`, { key, opt });
    }
    for (const alias of opt.aliases ?? []) {
      flagMap.set(`-${alias}`, { key, opt });
    }
  }

  // Init result: booleans → false, strings → undefined
  const result = {} as Record<string, string | boolean | undefined>;
  for (const [key, opt] of Object.entries(schema)) {
    result[key] = opt.type === 'boolean' ? false : undefined;
  }
  const positionals: string[] = [];

  let i = 0;
  while (i < rawArgs.length) {
    const arg = rawArgs[i];

    // --key=value form
    const eqIdx = arg.indexOf('=');
    if (eqIdx >= 2 && arg.startsWith('--')) {
      const flagName = arg.slice(0, eqIdx);
      const rawValue = arg.slice(eqIdx + 1);
      const entry = flagMap.get(flagName);
      if (entry) {
        const { key, opt } = entry;
        if (opt.type === 'boolean' || !opt.type) {
          result[key] = !['0', 'false', 'no'].includes(rawValue.toLowerCase());
        } else {
          result[key] = opt.map?.[rawValue] ?? rawValue;
        }
        i++;
        continue;
      }
      // Unknown --key=value → positional
      positionals.push(arg);
      i++;
      continue;
    }

    // --flag or --key value
    if (arg.startsWith('--')) {
      // Negation: --no-flag
      if (arg.startsWith('--no-')) {
        const entry = flagMap.get(arg);
        if (entry) {
          result[entry.key] = false;
          i++;
          continue;
        }
        positionals.push(arg);
        i++;
        continue;
      }

      const entry = flagMap.get(arg);
      if (!entry) {
        // Unknown flag → positional
        positionals.push(arg);
        i++;
        continue;
      }

      const { key, opt } = entry;
      if (opt.type === 'boolean' || !opt.type) {
        result[key] = true;
        i++;
        continue;
      }

      // String type — look ahead for value
      if (i + 1 < rawArgs.length && !rawArgs[i + 1].startsWith('-')) {
        const rawValue = rawArgs[i + 1];
        result[key] = opt.map?.[rawValue] ?? rawValue;
        i += 2;
        continue;
      }
      // No value found — keep undefined, skip flag
      i++;
      continue;
    }

    // -f short alias (optionally -f=value)
    if (arg.startsWith('-') && !arg.startsWith('--') && arg.length >= 2) {
      const aliasEq = arg.indexOf('=');
      const flagName = aliasEq >= 2 ? arg.slice(0, aliasEq) : arg.slice(0, 2);
      const entry = flagMap.get(flagName);
      if (entry) {
        const { key, opt } = entry;
        // -f=value form
        if (aliasEq >= 2) {
          const rawValue = arg.slice(aliasEq + 1);
          result[key] = opt.map?.[rawValue] ?? rawValue;
          i++;
          continue;
        }
        if (opt.type === 'boolean' || !opt.type) {
          result[key] = true;
          i++;
          continue;
        }
        // Look ahead for value
        if (i + 1 < rawArgs.length && !rawArgs[i + 1].startsWith('-')) {
          const rawValue = rawArgs[i + 1];
          result[key] = opt.map?.[rawValue] ?? rawValue;
          i += 2;
          continue;
        }
        i++;
        continue;
      }
      // Unknown short flag → positional
      positionals.push(arg);
      i++;
      continue;
    }

    // Plain positional
    positionals.push(arg);
    i++;
  }

  return { ...result, _: positionals } as CliResult<T>;
}

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
// Env File Helpers
// ============================================================================

/**
 * Parse a `.env` file into a record of key-value pairs.
 */
export const parseEnvFile = async (filePath: string): Promise<Record<string, string>> => {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return {};
  }

  const vars: Record<string, string> = {};
  const lines = (await file.text()).split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) {
      continue;
    }
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (key) {
      // Strip surrounding quotes
      if (
        (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
        (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
      ) {
        value = value.slice(1, -1);
      }
      vars[key] = value;
    }
  }

  return vars;
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
