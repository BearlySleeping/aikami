/**
 * apps/backend/local-stack/stack/prompt.ts
 *
 * Interactive prompt adapter for `stack init` (C-391 / C-418 Feature F).
 *
 * Two implementations behind one interface:
 *
 *   - **Rich** (`@clack/prompts`): arrow-key navigation and space-to-toggle
 *     checkboxes, so choosing modalities is a toggle list instead of typing
 *     `text,image,voice,stt` correctly by hand. Used whenever the session is a
 *     real TTY with colour enabled.
 *   - **Plain** (line-oriented `[y/N]` / comma-separated): the fallback for
 *     `NO_COLOR`, `--no-color`, and any non-TTY. C-391's output contract says
 *     plain text with no colour and no Unicode in those cases, and a checkbox
 *     UI is neither — so the rich layer is opt-out by the same switch that
 *     turns off colour, not a second flag nobody knows about.
 *
 * Non-TTY never prompts at all: every function returns the caller's default,
 * which is what keeps `--yes`, `curl | sh`, and the tests deterministic.
 *
 * Cancelling (Ctrl-C / Esc) is a first-class answer, not an exception: clack
 * returns its cancel symbol, this module maps that to `CANCELLED`, and the
 * caller aborts without writing anything.
 */

import process from 'node:process';
import {
  confirm as clackConfirm,
  multiselect as clackMultiselect,
  select as clackSelect,
  isCancel,
} from '@clack/prompts';

/** Returned when the user cancels (Ctrl-C / Esc) instead of answering. */
export const CANCELLED = Symbol('prompt-cancelled');
export type Cancelled = typeof CANCELLED;

export type PromptStyle = 'rich' | 'plain' | 'none';

/**
 * Which prompt implementation this session gets.
 *
 * `none` means "do not ask anything" — the caller's defaults stand. That is
 * the case for a pipe on either end (`curl | sh`, CI, the test suite).
 */
export const promptStyle = (options: { readonly noColor: boolean }): PromptStyle => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return 'none';
  }
  return options.noColor || process.env.NO_COLOR ? 'plain' : 'rich';
};

// ── Plain (line-oriented) implementation ──────────────────────────────────

/** Reads one line from stdin. Caller writes the prompt first. */
const readLine = (): Promise<string> =>
  new Promise<string>((resolve) => {
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

// ── Public API ────────────────────────────────────────────────────────────

export type Choice<T extends string> = {
  readonly value: T;
  /** One-line explanation shown beside the option in the rich UI. */
  readonly hint?: string;
};

/**
 * clack's `Option.hint` is an optional property, and the project compiles with
 * exactOptionalPropertyTypes — so an absent hint has to be an absent key, not
 * an explicit `undefined`.
 */
const toClackOption = <T extends string>(
  choice: Choice<T>,
): { value: T; label: T; hint?: string } =>
  choice.hint === undefined
    ? { value: choice.value, label: choice.value }
    : { value: choice.value, label: choice.value, hint: choice.hint };

export type PromptOptions = {
  /** Prompt implementation for this session (from `promptStyle`). */
  readonly style: PromptStyle;
};

/** Asks one yes/no question. Returns the default when not prompting. */
export const confirm = async (
  question: string,
  defaultValue: boolean,
  options: PromptOptions,
): Promise<boolean | Cancelled> => {
  if (options.style === 'none') {
    return defaultValue;
  }
  if (options.style === 'rich') {
    const answer = await clackConfirm({ message: question, initialValue: defaultValue });
    return isCancel(answer) ? CANCELLED : answer;
  }
  process.stdout.write(`${question} ${defaultValue ? '[Y/n]' : '[y/N]'} `);
  const input = await readLine();
  if (input.length === 0) {
    return defaultValue;
  }
  return /^y(es)?$/i.test(input);
};

/** Asks a single-choice question. Returns the default when not prompting. */
export const select = async <T extends string>(
  question: string,
  choices: readonly Choice<T>[],
  defaultValue: T,
  options: PromptOptions,
): Promise<T | Cancelled> => {
  if (options.style === 'none') {
    return defaultValue;
  }
  if (options.style === 'rich') {
    // Instantiated at `string`, not at `T`: clack's `Option<Value>` is a
    // conditional type, and with an unresolved generic it stays deferred so
    // TypeScript cannot check the options array against it at all. Every `T`
    // here is a string literal union, so widening for the call and narrowing
    // the result is sound.
    const answer = await clackSelect<string>({
      message: question,
      initialValue: defaultValue,
      options: choices.map(toClackOption),
    });
    return isCancel(answer) ? CANCELLED : (answer as T);
  }
  const values = choices.map((choice) => choice.value);
  process.stdout.write(`${question} [${values.join('/')}] (default: ${defaultValue}) `);
  const input = await readLine();
  if (input.length === 0) {
    return defaultValue;
  }
  const match = values.find((value) => value.toLowerCase() === input.toLowerCase());
  if (!match) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.warn(`  (unrecognized "${input}" — using default: ${defaultValue})`);
    return defaultValue;
  }
  return match;
};

/**
 * Asks a multi-choice question — a space-to-toggle checkbox list in the rich
 * UI, a comma-separated line otherwise. Returns the default when not
 * prompting.
 *
 * The plain path never matches the raw input against `choices` as a single
 * token; that would make every multi-value answer ("text,image,client")
 * silently fall back to the default, which is exactly what happened before
 * this was fixed — nobody could select a non-default combination
 * interactively. Unrecognized tokens (typos) are dropped with a warning,
 * not treated as grounds to discard the whole answer.
 */
export const multiselect = async <T extends string>(
  question: string,
  choices: readonly Choice<T>[],
  defaultValue: readonly T[],
  options: PromptOptions,
): Promise<readonly T[] | Cancelled> => {
  if (options.style === 'none') {
    return defaultValue;
  }
  if (options.style === 'rich') {
    // Widened to `string` for the same reason as `select` above.
    const answer = await clackMultiselect<string>({
      message: question,
      initialValues: [...defaultValue],
      // An empty selection is a legitimate answer to "which engines?" only in
      // the sense of "none of them", which would write a stack that starts
      // nothing — require at least one instead of writing a useless .env.
      required: true,
      options: choices.map(toClackOption),
    });
    // clack echoes back the option `value`s it was handed, so every element is
    // one of `choices` — the widening above is what loses that for the checker.
    return isCancel(answer) ? CANCELLED : (answer as readonly string[] as readonly T[]);
  }
  const values = choices.map((choice) => choice.value);
  process.stdout.write(`${question} [${values.join('/')}] (default: ${defaultValue.join(',')}) `);
  const input = await readLine();
  if (input.length === 0) {
    return defaultValue;
  }
  const tokens = input
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  const picked: T[] = [];
  const unknown: string[] = [];
  for (const token of tokens) {
    const match = values.find((value) => value.toLowerCase() === token);
    if (match) {
      picked.push(match);
    } else {
      unknown.push(token);
    }
  }
  if (unknown.length > 0) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.warn(`  (ignoring unrecognized: ${unknown.join(', ')})`);
  }
  if (picked.length === 0) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.warn(`  (nothing recognized — using default: ${defaultValue.join(',')})`);
    return defaultValue;
  }
  return picked;
};
