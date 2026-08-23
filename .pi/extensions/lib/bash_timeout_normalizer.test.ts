import { describe, expect, test } from 'bun:test';
import { quoteExecTerminators } from '../bash_timeout_normalizer.ts';

/**
 * Regression cover for the @hypabolic/pi-hypa rewriter bug observed
 * 2026-08-23: an unquoted `\;` made hypa emit a stray `\"`, leaving its
 * `hypa -c "…"` wrapper unterminated, and bash rejected the command with
 * `unexpected EOF while looking for matching '"'`. The model then retried
 * identically until storm-breaker killed the session.
 *
 * 🔴 Every input here uses String.raw. A plain '\;' in TypeScript source is
 * an invalid escape and collapses to ';' — which silently tests nothing.
 */
const raw = String.raw;

describe('quoteExecTerminators', () => {
  test('rewrites an unquoted find -exec terminator', () => {
    expect(quoteExecTerminators(raw`find . -name "*.mjs" -exec grep -l "x" {} \;`)).toBe(
      `find . -name "*.mjs" -exec grep -l "x" {} ';'`,
    );
  });

  test('rewrites a bare escaped semicolon used as a separator', () => {
    expect(quoteExecTerminators(raw`echo hi \; echo bye`)).toBe(`echo hi ';' echo bye`);
  });

  test('leaves an escaped semicolon inside double quotes alone', () => {
    // There it is literal text — a grep pattern, say — and hypa handles it.
    const command = raw`echo "a\;b"`;
    expect(quoteExecTerminators(command)).toBe(command);
  });

  test('leaves an escaped semicolon inside single quotes alone', () => {
    const command = raw`grep 'a\;b' file.txt`;
    expect(quoteExecTerminators(command)).toBe(command);
  });

  test('leaves an already-quoted terminator untouched (idempotent)', () => {
    const command = `find . -exec echo {} ';'`;
    expect(quoteExecTerminators(command)).toBe(command);
    expect(quoteExecTerminators(quoteExecTerminators(command))).toBe(command);
  });

  test('preserves other escape pairs verbatim', () => {
    const command = raw`grep -E "a\.b" . && echo \$HOME`;
    expect(quoteExecTerminators(command)).toBe(command);
  });

  test('handles an escaped quote inside double quotes without losing state', () => {
    // The \" must not be read as closing the string, or the following \;
    // would be wrongly treated as quoted and left unfixed.
    expect(quoteExecTerminators(raw`echo "say \"hi\"" && find . -exec ls {} \;`)).toBe(
      `${raw`echo "say \"hi\"" && find . -exec ls {} `}';'`,
    );
  });

  test('leaves commands with no terminator unchanged', () => {
    const command = 'cd /tmp && grep -rn "needle" . | head -5';
    expect(quoteExecTerminators(command)).toBe(command);
  });

  test('handles the exact command from the 2026-08-23 failure', () => {
    const command = raw`cd /home/sonny/Development/Projects/passion/aikami && find node_modules/.bun/better-auth@1.7.1+3dcb832192e3943b -name "*.mjs" -exec grep -l "getSignedCookie" {} \; 2>/dev/null`;
    expect(quoteExecTerminators(command)).toContain(`{} ';' 2>/dev/null`);
    expect(quoteExecTerminators(command)).not.toContain(raw`\;`);
  });
});
