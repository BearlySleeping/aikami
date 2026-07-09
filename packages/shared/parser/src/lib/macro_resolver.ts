// packages/shared/parser/src/lib/macro_resolver.ts
//
// Pure macro resolution engine for prompt templates (C-237).
// Uses a proper nested-brace parser instead of regex for macro detection,
// handling nested macros correctly (e.g. {{uppercase::Hello {{user}}!}}).
// Categories: identity, character, context, time, random (incl. weighted +
// dice), variables, formatting (trim, uppercase/lowercase), conditionals
// (#if//if), circular-reference guard (max 10 passes).

import { logger } from '$logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Context data provided to macro resolution. */
export type MacroContext = {
  userName?: string;
  characterName?: string;
  characterDescription?: string;
  characterPersonality?: string;
  scenario?: string;
  persona?: string;
  chatHistory?: string;
  userMessage?: string;
  otherCharacters?: string;
  extraContext?: Record<string, string>;
};

/** Weighted option for random macros. */
export type WeightedOption = { text: string; weight: number };

/** Variable scope for a single template invocation. */
export type VariableScope = Record<string, string | number>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RESOLUTION_PASSES = 10;
const CIRCULAR_SENTINEL = '[CIRCULAR]';

/**
 * Marker used to encode unknown macros during resolution passes.
 * The null bytes ensure the tokenizer's `{{` detector won't catch them,
 * preventing infinite re-resolution loops. Restored to `{{...}}` at the end.
 */
const UNKNOWN_PREFIX = '\x00UNK:';
const UNKNOWN_SUFFIX = '\x00';

// ---------------------------------------------------------------------------
// Patterns for macro inner-content parsing
// ---------------------------------------------------------------------------

const PATTERNS = {
  simpleMacro: /^([\w-]+)(?:::(.*))?$/s,
  ifConditional: /^#if\s+([\w-]+)\s*==\s*"([^"]*)"$/,
  setVar: /^setvar::([\w-]+)::(.+)$/s,
  getVar: /^getvar::([\w-]+)$/,
  incVar: /^incvar::([\w-]+)(?:::\s*(\d+))?$/,
  decVar: /^decvar::([\w-]+)(?:::\s*(\d+))?$/,
  trim: /^trim::(.+)$/s,
  uppercase: /^uppercase::(.+)$/s,
  lowercase: /^lowercase::(.+)$/s,
  random: /^random::(.+)$/s,
  weightedOption: /^(.+?)\|\|(\d+)$/,
} as const;

// ---------------------------------------------------------------------------
// Token parser for nested {{...}} macros
// ---------------------------------------------------------------------------

type MacroToken = { type: 'text'; value: string } | { type: 'macro'; inner: string };

/**
 * Tokenizes a template string into text segments and macro tokens,
 * properly handling nested `{{...}}` pairs.
 */
const tokenize = (template: string): MacroToken[] => {
  const tokens: MacroToken[] = [];
  let i = 0;
  let textStart = 0;

  while (i < template.length) {
    // Look for `{{`
    if (template[i] === '{' && i + 1 < template.length && template[i + 1] === '{') {
      // Flush accumulated text
      if (textStart < i) {
        tokens.push({ type: 'text', value: template.slice(textStart, i) });
      }

      // Find matching `}}` respecting nesting
      i += 2; // skip `{{`
      const innerStart = i;
      let depth = 1;

      while (i < template.length && depth > 0) {
        if (template[i] === '{' && i + 1 < template.length && template[i + 1] === '{') {
          depth++;
          i += 2;
        } else if (template[i] === '}' && i + 1 < template.length && template[i + 1] === '}') {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }

      if (depth > 0) {
        // Unclosed `{{` — flush everything from textStart as literal text
        tokens.push({ type: 'text', value: template.slice(textStart) });
        textStart = template.length;
        break;
      }

      const inner = template.slice(innerStart, i - 2); // exclude `}}`
      tokens.push({ type: 'macro', inner });
      textStart = i;
    } else {
      i++;
    }
  }

  // Flush remaining text
  if (textStart < template.length) {
    tokens.push({ type: 'text', value: template.slice(textStart) });
  }

  return tokens;
};

// ---------------------------------------------------------------------------
// Main resolver
// ---------------------------------------------------------------------------

/**
 * Resolves all macros in a template string using the provided context.
 *
 * Uses a proper nested-brace tokenizer so macros like
 * `{{uppercase::Hello {{user}}!}}` resolve correctly (inner first,
 * outer transform after).
 *
 * @param options.template - Raw template string with `{{macro}}` tokens.
 * @param options.context - Context for identity/character/context macros.
 * @returns Fully resolved template string.
 */
export const resolveMacros = (options: { template: string; context: MacroContext }): string => {
  const { template, context } = options;
  const variables: VariableScope = {};

  let resolved = template;
  let passCount = 0;

  while (passCount < MAX_RESOLUTION_PASSES) {
    passCount++;
    const tokens = tokenize(resolved);
    const hasMacros = tokens.some((t) => t.type === 'macro');

    if (!hasMacros) {
      break;
    }

    resolved = tokens
      .map((token) => {
        if (token.type === 'text') {
          return token.value;
        }
        return resolveSingleMacro({
          inner: token.inner,
          context,
          variables,
        });
      })
      .join('');
  }

  // Restore unknown-macro markers back to {{...}} form
  resolved = restoreUnknownMarkers(resolved);

  if (passCount >= MAX_RESOLUTION_PASSES) {
    logger.warn('resolveMacros:max-passes-reached', {
      template: template.slice(0, 100),
    });
    // Replace any remaining macro delimiters with sentinel
    resolved = resolved.replace(/\{\{/g, CIRCULAR_SENTINEL).replace(/\}\}/g, '');
  }

  return resolved;
};

// ---------------------------------------------------------------------------
// Single macro resolution
// ---------------------------------------------------------------------------

/**
 * Resolves a single macro given its inner content.
 * Inner content may itself contain `{{macro}}` tokens which are
 * resolved first (recursively via the outer iteration).
 */
const resolveSingleMacro = (options: {
  inner: string;
  context: MacroContext;
  variables: VariableScope;
}): string => {
  const { inner, context, variables } = options;
  const trimmed = inner.trim();

  // ── Conditional: #if / /if ──────────────────────────────────────────
  // Phase 1: pass through as literal text.

  // ── Variable operations ─────────────────────────────────────────────
  const setVarMatch = trimmed.match(PATTERNS.setVar);
  if (setVarMatch) {
    const [, name, rawValue] = setVarMatch;
    // Store as number if the value looks numeric, otherwise as string
    const num = Number(rawValue);
    variables[name] = Number.isFinite(num) && rawValue.trim() !== '' ? num : rawValue;
    return '';
  }

  const getVarMatch = trimmed.match(PATTERNS.getVar);
  if (getVarMatch) {
    const value = variables[getVarMatch[1]];
    return value !== undefined ? String(value) : '';
  }

  const incVarMatch = trimmed.match(PATTERNS.incVar);
  if (incVarMatch) {
    const amount = incVarMatch[2] ? Number.parseInt(incVarMatch[2], 10) || 1 : 1;
    const current =
      typeof variables[incVarMatch[1]] === 'number' ? (variables[incVarMatch[1]] as number) : 0;
    variables[incVarMatch[1]] = current + amount;
    return String(variables[incVarMatch[1]]);
  }

  const decVarMatch = trimmed.match(PATTERNS.decVar);
  if (decVarMatch) {
    const amount = decVarMatch[2] ? Number.parseInt(decVarMatch[2], 10) || 1 : 1;
    const current =
      typeof variables[decVarMatch[1]] === 'number' ? (variables[decVarMatch[1]] as number) : 0;
    variables[decVarMatch[1]] = current - amount;
    return String(variables[decVarMatch[1]]);
  }

  // ── Formatting macros ───────────────────────────────────────────────
  // These first resolve all inner {{macros}} in their content, then
  // apply the transform. This handles nested cases like
  // `{{uppercase::Hello {{user}}!}}` → resolve `{{user}}` first →
  // `Hello Alice!` → uppercase → `HELLO ALICE!`.
  const trimMatch = trimmed.match(PATTERNS.trim);
  if (trimMatch) {
    return resolveMacros({ template: trimMatch[1], context }).trim();
  }

  const upperMatch = trimmed.match(PATTERNS.uppercase);
  if (upperMatch) {
    return resolveMacros({ template: upperMatch[1], context }).toUpperCase();
  }

  const lowerMatch = trimmed.match(PATTERNS.lowercase);
  if (lowerMatch) {
    return resolveMacros({ template: lowerMatch[1], context }).toLowerCase();
  }

  // ── Random macros ───────────────────────────────────────────────────
  const randomMatch = trimmed.match(PATTERNS.random);
  if (randomMatch) {
    // Resolve any inner macros in the random options first
    const resolvedOptions = resolveMacros({ template: randomMatch[1], context });
    return resolveRandom(resolvedOptions);
  }

  // ── Simple macros (identity, character, context, time, dice) ─────────
  const simpleMatch = trimmed.match(PATTERNS.simpleMacro);
  if (simpleMatch) {
    return resolveSimpleMacro({
      name: simpleMatch[1],
      args: simpleMatch[2],
      context,
    });
  }

  // ── Unknown macro — encode with marker to avoid re-resolution ────────
  return `${UNKNOWN_PREFIX}${trimmed}${UNKNOWN_SUFFIX}`;
};

// ---------------------------------------------------------------------------
// Simple macro resolution
// ---------------------------------------------------------------------------

const resolveSimpleMacro = (options: {
  name: string;
  args: string | undefined;
  context: MacroContext;
}): string => {
  const { name, args, context } = options;

  // Identity
  if (name === 'user') {
    return context.userName ?? '';
  }
  if (name === 'char') {
    return context.characterName ?? '';
  }

  // Character
  if (name === 'description') {
    return context.characterDescription ?? '';
  }
  if (name === 'personality') {
    return context.characterPersonality ?? '';
  }

  // Context
  if (name === 'scenario') {
    return context.scenario ?? '';
  }
  if (name === 'persona') {
    return context.persona ?? '';
  }
  if (name === 'history') {
    return context.chatHistory ?? '';
  }
  if (name === 'message') {
    return context.userMessage ?? '';
  }
  if (name === 'other_characters') {
    return context.otherCharacters ?? '';
  }

  // Extra context
  if (name === 'getcontext') {
    const key = args ? args.trim() : '';
    if (key && context.extraContext?.[key] !== undefined) {
      return context.extraContext[key];
    }
    return '';
  }

  // Time
  if (name === 'time') {
    return new Date().toLocaleTimeString();
  }
  if (name === 'date') {
    return new Date().toLocaleDateString();
  }
  if (name === 'datetime') {
    return new Date().toLocaleString();
  }
  if (name === 'timestamp') {
    return String(Date.now());
  }

  // Dice
  if (name === 'dice' && args) {
    return resolveDiceRoll(args.trim());
  }

  // Unknown — encode with marker
  // args is defined (even '') when :: was present, undefined otherwise
  const hasArgs = args !== undefined;
  const fullInner = hasArgs ? `${name}::${args ?? ''}` : name;
  return `${UNKNOWN_PREFIX}${fullInner}${UNKNOWN_SUFFIX}`;
};

// ---------------------------------------------------------------------------
// Random macro helpers
// ---------------------------------------------------------------------------

const resolveRandom = (rawOptions: string): string => {
  if (!rawOptions) {
    return '';
  }

  const parts = rawOptions.split('::');
  const hasWeighted = parts.some((part) => PATTERNS.weightedOption.test(part));

  if (hasWeighted) {
    return resolveWeightedRandom(parts);
  }

  const index = Math.floor(Math.random() * parts.length);
  const result = parts[index];
  return result ?? '';
};

const resolveWeightedRandom = (parts: string[]): string => {
  const weighted: WeightedOption[] = [];
  let hasNonZeroWeight = false;

  for (const part of parts) {
    const match = part.match(PATTERNS.weightedOption);
    if (match) {
      const text = match[1].trim();
      const weight = Number(match[2]);
      if (!Number.isFinite(weight) || weight < 0) {
        weighted.push({ text: part, weight: 1 });
        hasNonZeroWeight = true;
      } else if (weight > 0) {
        weighted.push({ text, weight });
        hasNonZeroWeight = true;
      } else {
        weighted.push({ text, weight: 0 });
      }
    } else {
      weighted.push({ text: part, weight: 1 });
      hasNonZeroWeight = true;
    }
  }

  if (!hasNonZeroWeight) {
    return '';
  }

  const totalWeight = weighted.reduce((sum, opt) => sum + opt.weight, 0);
  let roll = Math.random() * totalWeight;

  for (const option of weighted) {
    roll -= option.weight;
    if (roll <= 0) {
      return option.text;
    }
  }

  const last = weighted[weighted.length - 1];
  return last?.text ?? '';
};

// ---------------------------------------------------------------------------
// Dice roll helper
// ---------------------------------------------------------------------------

const resolveDiceRoll = (expression: string): string => {
  const diceMatch = expression.match(/^(\d+)d(\d+)(?:([+-])(\d+))?$/);
  if (!diceMatch) {
    return expression;
  }

  const count = Number.parseInt(diceMatch[1], 10);
  const sides = Number.parseInt(diceMatch[2], 10);
  const modifierSign = diceMatch[3];
  const modifierValue = diceMatch[4] ? Number.parseInt(diceMatch[4], 10) : 0;

  if (count < 1 || sides < 1 || count > 100 || sides > 1000) {
    return expression;
  }

  let total = 0;
  for (let i = 0; i < count; i++) {
    total += Math.floor(Math.random() * sides) + 1;
  }

  if (modifierSign === '+') {
    total += modifierValue;
  } else if (modifierSign === '-') {
    total -= modifierValue;
  }

  return String(total);
};

// ---------------------------------------------------------------------------
// Unknown-macro marker helpers
// ---------------------------------------------------------------------------

/**
 * Restores unknown-macro markers back to `{{...}}` form.
 */
const restoreUnknownMarkers = (text: string): string => {
  const prefix = escapeRegex(UNKNOWN_PREFIX);
  const suffix = escapeRegex(UNKNOWN_SUFFIX);
  const pattern = new RegExp(`${prefix}(.*?)${suffix}`, 'g');
  return text.replace(pattern, (_match, inner: string) => `{{${inner}}}`);
};

/**
 * Escapes special regex characters in a string for use in a RegExp.
 */
const escapeRegex = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};
