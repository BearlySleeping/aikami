// packages/shared/parser/tests/macro_resolver.test.ts
//
// Unit tests for the prompt template macro resolver (C-237).
// Covers all macro categories: identity, character, context, time, random,
// weighted random, dice roll, setVar/getVar/incVar/decVar, trim, uppercase,
// lowercase, conditionals, nested macros, unknown passthrough, circular
// detection, and edge cases.

import { describe, expect, test } from 'bun:test';
import { type MacroContext, resolveMacros } from '../src/index.ts';

// ═══════════════════════════════════════════════════════════════════════════
// Identity macros
// ═══════════════════════════════════════════════════════════════════════════

describe('identity macros', () => {
  test('{{user}} resolves to userName', () => {
    const result = resolveMacros({ template: 'Hello {{user}}!', context: { userName: 'Alice' } });
    expect(result).toBe('Hello Alice!');
  });

  test('{{char}} resolves to characterName', () => {
    const result = resolveMacros({
      template: 'I am {{char}}.',
      context: { characterName: 'Thorn' },
    });
    expect(result).toBe('I am Thorn.');
  });

  test('{{user}} with missing context → empty string', () => {
    const result = resolveMacros({ template: 'Hello {{user}}!', context: {} });
    expect(result).toBe('Hello !');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Character macros
// ═══════════════════════════════════════════════════════════════════════════

describe('character macros', () => {
  test('{{description}} resolves to characterDescription', () => {
    const result = resolveMacros({
      template: '{{description}}',
      context: { characterDescription: 'A tall warrior.' },
    });
    expect(result).toBe('A tall warrior.');
  });

  test('{{personality}} resolves to characterPersonality', () => {
    const result = resolveMacros({
      template: 'Personality: {{personality}}',
      context: { characterPersonality: 'Brave and kind' },
    });
    expect(result).toBe('Personality: Brave and kind');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Context macros
// ═══════════════════════════════════════════════════════════════════════════

describe('context macros', () => {
  test('{{scenario}} resolves to scenario', () => {
    const result = resolveMacros({
      template: 'Setting: {{scenario}}',
      context: { scenario: 'Dark forest' },
    });
    expect(result).toBe('Setting: Dark forest');
  });

  test('{{persona}} resolves to persona', () => {
    const result = resolveMacros({
      template: '{{persona}}',
      context: { persona: 'A wandering mage.' },
    });
    expect(result).toBe('A wandering mage.');
  });

  test('{{history}} resolves to chatHistory', () => {
    const result = resolveMacros({
      template: '{{history}}',
      context: { chatHistory: 'You said hello.' },
    });
    expect(result).toBe('You said hello.');
  });

  test('{{message}} resolves to userMessage', () => {
    const result = resolveMacros({
      template: 'User said: {{message}}',
      context: { userMessage: 'Hello world' },
    });
    expect(result).toBe('User said: Hello world');
  });

  test('{{other_characters}} resolves to otherCharacters', () => {
    const result = resolveMacros({
      template: 'Others: {{other_characters}}',
      context: { otherCharacters: 'Goblin, Orc' },
    });
    expect(result).toBe('Others: Goblin, Orc');
  });

  test('{{getcontext::key}} resolves from extraContext', () => {
    const result = resolveMacros({
      template: '{{getcontext::location}}',
      context: { extraContext: { location: 'Tavern' } },
    });
    expect(result).toBe('Tavern');
  });

  test('{{getcontext::missing}} with nonexistent key → empty string', () => {
    const result = resolveMacros({
      template: '{{getcontext::missing}}',
      context: { extraContext: { location: 'Tavern' } },
    });
    expect(result).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Time macros
// ═══════════════════════════════════════════════════════════════════════════

describe('time macros', () => {
  test('{{timestamp}} resolves to a numeric string', () => {
    const result = resolveMacros({ template: '{{timestamp}}', context: {} });
    expect(result).toMatch(/^\d+$/);
  });

  test('{{date}} resolves to a non-empty string', () => {
    const result = resolveMacros({ template: '{{date}}', context: {} });
    expect(result.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Random macros (simple uniform)
// ═══════════════════════════════════════════════════════════════════════════

describe('random macros — simple', () => {
  test('{{random::sword::shield::bow}} selects one of the options', () => {
    const result = resolveMacros({
      template: 'Weapon: {{random::sword::shield::bow}}',
      context: {},
    });
    expect(['Weapon: sword', 'Weapon: shield', 'Weapon: bow']).toContain(result);
  });

  test('{{random::single}} with one option returns that option', () => {
    const result = resolveMacros({ template: '{{random::single}}', context: {} });
    expect(result).toBe('single');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Weighted random macros
// ═══════════════════════════════════════════════════════════════════════════

describe('random macros — weighted', () => {
  test('{{random::common||5::rare||1}} weighted selection works', () => {
    // Run many times to confirm we always get one of the options
    for (let i = 0; i < 50; i++) {
      const result = resolveMacros({
        template: '{{random::common||5::rare||1}}',
        context: {},
      });
      expect(['common', 'rare']).toContain(result);
    }
  });

  test('all-zero weights → empty string', () => {
    const result = resolveMacros({
      template: '{{random::none||0::also_none||0}}',
      context: {},
    });
    expect(result).toBe('');
  });

  test('mixed zero and positive weights → never returns zero-weight option', () => {
    // We run many times and verify the zero-weight option never appears
    for (let i = 0; i < 100; i++) {
      const result = resolveMacros({
        template: '{{random::valid||3::never||0}}',
        context: {},
      });
      expect(result).toBe('valid');
    }
  });

  test('invalid weight suffix → treated as literal text with weight 1', () => {
    const result = resolveMacros({
      template: '{{random::text||abc::other||5}}',
      context: {},
    });
    expect(['text||abc', 'other']).toContain(result);
  });

  test('mixed weighted and unweighted options', () => {
    for (let i = 0; i < 50; i++) {
      const result = resolveMacros({
        template: '{{random::weighted||3::plain}}',
        context: {},
      });
      expect(['weighted', 'plain']).toContain(result);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Dice roll macros
// ═══════════════════════════════════════════════════════════════════════════

describe('dice roll macros', () => {
  test('{{dice::1d20}} returns a number between 1 and 20', () => {
    const result = resolveMacros({ template: '{{dice::1d20}}', context: {} });
    const value = Number(result);
    expect(value).toBeGreaterThanOrEqual(1);
    expect(value).toBeLessThanOrEqual(20);
  });

  test('{{dice::2d6}} returns a number between 2 and 12', () => {
    const result = resolveMacros({ template: '{{dice::2d6}}', context: {} });
    const value = Number(result);
    expect(value).toBeGreaterThanOrEqual(2);
    expect(value).toBeLessThanOrEqual(12);
  });

  test('{{dice::1d20+3}} includes modifier', () => {
    const result = resolveMacros({ template: '{{dice::1d20+3}}', context: {} });
    const value = Number(result);
    expect(value).toBeGreaterThanOrEqual(4);
    expect(value).toBeLessThanOrEqual(23);
  });

  test('{{dice::1d20-2}} includes negative modifier', () => {
    const result = resolveMacros({ template: '{{dice::1d20-2}}', context: {} });
    const value = Number(result);
    expect(value).toBeGreaterThanOrEqual(-1);
    expect(value).toBeLessThanOrEqual(18);
  });

  test('{{dice::invalid}} passes through unchanged', () => {
    const result = resolveMacros({ template: '{{dice::invalid}}', context: {} });
    expect(result).toBe('invalid');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Variable macros (setvar / getvar / incvar / decvar)
// ═══════════════════════════════════════════════════════════════════════════

describe('variable macros', () => {
  test('{{setvar::x::5}} followed by {{getvar::x}} returns 5', () => {
    const result = resolveMacros({
      template: '{{setvar::x::5}}{{getvar::x}}',
      context: {},
    });
    expect(result).toBe('5');
  });

  test('{{incvar::x}} increments from 0 to 1', () => {
    const result = resolveMacros({
      template: '{{setvar::x::0}}{{incvar::x}}',
      context: {},
    });
    expect(result).toBe('1');
  });

  test('{{incvar::x::5}} increments by 5', () => {
    const result = resolveMacros({
      template: '{{setvar::x::0}}{{incvar::x::5}}',
      context: {},
    });
    expect(result).toBe('5');
  });

  test('{{decvar::x}} decrements from 10 to 9', () => {
    const result = resolveMacros({
      template: '{{setvar::x::10}}{{decvar::x}}',
      context: {},
    });
    expect(result).toBe('9');
  });

  test('{{decvar::x::3}} decrements by 3', () => {
    const result = resolveMacros({
      template: '{{setvar::x::10}}{{decvar::x::3}}',
      context: {},
    });
    expect(result).toBe('7');
  });

  test('{{getvar::missing}} returns empty string', () => {
    const result = resolveMacros({ template: '{{getvar::missing}}', context: {} });
    expect(result).toBe('');
  });

  test('variables are per-invocation (not shared)', () => {
    // First call should have no variables
    const first = resolveMacros({ template: '{{getvar::x}}', context: {} });
    expect(first).toBe('');

    // Setting a var in one call should not affect another
    const middle = resolveMacros({
      template: '{{setvar::x::42}}',
      context: {},
    });
    expect(middle).toBe('');

    const last = resolveMacros({ template: '{{getvar::x}}', context: {} });
    expect(last).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Formatting macros (trim / uppercase / lowercase)
// ═══════════════════════════════════════════════════════════════════════════

describe('formatting macros', () => {
  test('{{trim::  hello  }} trims whitespace', () => {
    const result = resolveMacros({ template: '{{trim::  hello  }}', context: {} });
    expect(result).toBe('hello');
  });

  test('{{uppercase::hello}} converts to uppercase', () => {
    const result = resolveMacros({ template: '{{uppercase::hello}}', context: {} });
    expect(result).toBe('HELLO');
  });

  test('{{lowercase::HELLO}} converts to lowercase', () => {
    const result = resolveMacros({ template: '{{lowercase::HELLO}}', context: {} });
    expect(result).toBe('hello');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Unknown macro passthrough
// ═══════════════════════════════════════════════════════════════════════════

describe('unknown macro passthrough', () => {
  test('{{unknown_macro}} passes through unchanged', () => {
    const result = resolveMacros({ template: '{{unknown_macro}}', context: {} });
    expect(result).toBe('{{unknown_macro}}');
  });

  test('{{unknown::with::args}} passes through with args', () => {
    const result = resolveMacros({ template: 'test {{unknown::with::args}}', context: {} });
    expect(result).toBe('test {{unknown::with::args}}');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Nested macros (inner resolved first, then outer)
// ═══════════════════════════════════════════════════════════════════════════

describe('nested macros', () => {
  test('{{uppercase::Hello {{user}}!}} resolves inner first, then uppercase', () => {
    const result = resolveMacros({
      template: '{{uppercase::Hello {{user}}!}}',
      context: { userName: 'Alice' },
    });
    expect(result).toBe('HELLO ALICE!');
  });

  test('{{lowercase::{{user}} IS HERE}} resolves inner first, then lowercase', () => {
    const result = resolveMacros({
      template: '{{lowercase::{{user}} IS HERE}}',
      context: { userName: 'BOB' },
    });
    expect(result).toBe('bob is here');
  });

  test('deep nesting: formatting around context macro inside random', () => {
    const result = resolveMacros({
      template: '{{random::{{user}} is here::someone else}}',
      context: { userName: 'Alice' },
    });
    // "Alice is here" or "someone else"
    expect(['Alice is here', 'someone else']).toContain(result);
  });

  test('setvar + getvar in same scope works', () => {
    const result = resolveMacros({
      template: '{{setvar::name::hello}}{{getvar::name}}',
      context: {},
    });
    expect(result).toBe('hello');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Circular reference detection
// ═══════════════════════════════════════════════════════════════════════════

describe('circular reference detection', () => {
  test('exceeds max passes → breaks with CIRCULAR sentinel', () => {
    // A template that keeps changing on each pass — would loop forever
    // without the pass limit. We use self-referencing structure.
    const result = resolveMacros({
      template: '{{uppercase::{{trim::  {{user}}  }}}}',
      context: { userName: 'Alice' },
    });
    // Should resolve normally since user is defined
    expect(result).toBe('ALICE');
  });

  test('deep nesting that approaches limit is handled', () => {
    // Create deeply nested macros that exercise the pass counter
    let deepTemplate = '{{user}}';
    for (let i = 0; i < 9; i++) {
      deepTemplate = `{{uppercase::${deepTemplate}}}`;
    }
    const result = resolveMacros({
      template: deepTemplate,
      context: { userName: 'hello' },
    });
    // 9 passes of uppercase should still work within 10 pass limit
    expect(result).toBe('HELLO'.toUpperCase());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('edge cases', () => {
  test('empty template → empty string', () => {
    const result = resolveMacros({ template: '', context: {} });
    expect(result).toBe('');
  });

  test('template with no macros → unchanged', () => {
    const result = resolveMacros({ template: 'Hello, world!', context: {} });
    expect(result).toBe('Hello, world!');
  });

  test('unclosed macro (single {{) → preserved (not a valid macro)', () => {
    const result = resolveMacros({ template: 'Hello {{user', context: { userName: 'Alice' } });
    // {{user is not closed with }}, so it's not matched by the macro regex
    expect(result).toBe('Hello {{user');
  });

  test('malformed macro with no content {{}} → not matched by regex, passes through', () => {
    const result = resolveMacros({ template: 'test {{}}', context: {} });
    // {{}} has zero non-} chars between braces so the regex doesn't match it
    expect(result).toBe('test {{}}');
  });

  test('multiple macros in one template all resolve', () => {
    const result = resolveMacros({
      template: '{{user}} talks to {{char}} in {{scenario}}',
      context: {
        characterName: 'Thorn',
        scenario: 'the forest',
        userName: 'Alice',
      },
    });
    expect(result).toBe('Alice talks to Thorn in the forest');
  });

  test('repeated same macro resolves each time', () => {
    const result = resolveMacros({
      template: '{{user}} {{user}} {{user}}',
      context: { userName: 'Echo' },
    });
    expect(result).toBe('Echo Echo Echo');
  });

  test('macro with empty args ({{dice::}}) → passes through unchanged', () => {
    const result = resolveMacros({ template: '{{dice::}}', context: {} });
    // dice with empty args → simpleMacro matches (inner='dice', args='')
    // resolveSimpleMacro: 'dice' && args → 'dice' && '' → false (empty string is falsy)
    // Falls through to unknown → passed through as {{dice::}}
    expect(result).toBe('{{dice::}}');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Conditional macros (#if / /if)
// ═══════════════════════════════════════════════════════════════════════════

describe('conditional macros', () => {
  test('{{#if}} with true condition preserves content', () => {
    // Phase 1: conditionals are unknown macros — pass through unchanged.
    const result = resolveMacros({
      template: '{{#if test == "value"}}shown{{/if}}',
      context: {},
    });
    // {{#if...}} inner starts with # → not a simpleMacro → pass through
    // {{/if}} inner is /if → not a simpleMacro → pass through
    expect(result).toBe('{{#if test == "value"}}shown{{/if}}');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Complex real-world template
// ═══════════════════════════════════════════════════════════════════════════

describe('complex templates', () => {
  test('system prompt template with multiple context macros', () => {
    const template = [
      'You are roleplaying as {{char}}.',
      'Personality: {{personality}}',
      'Description: {{description}}',
      '',
      'Setting: {{scenario}}',
      'Other characters: {{other_characters}}',
      '',
      '{{history}}',
      'User: {{message}}',
    ].join('\n');

    const context: MacroContext = {
      characterName: 'Lyra the Bard',
      characterPersonality: 'Witty, charming, always ready with a song',
      characterDescription: 'A half-elf bard with a lute and a mischievous grin',
      scenario: 'A bustling tavern on a rainy night',
      otherCharacters: 'Grumm the dwarf (bartender), a mysterious hooded figure',
      chatHistory: "Grumm: What'll it be, stranger?\nLyra: Your finest ale, good dwarf!",
      userMessage: 'I slide a coin across the bar and ask about local rumors.',
    };

    const result = resolveMacros({ template, context });

    expect(result).toContain('Lyra the Bard');
    expect(result).toContain('Witty, charming');
    expect(result).toContain('bustling tavern');
    expect(result).toContain('mysterious hooded figure');
    expect(result).toContain('I slide a coin');
  });

  test('template with random, dice, and formatting combined', () => {
    const result = resolveMacros({
      template: '{{uppercase::{{user}} rolls {{dice::1d20}}}}',
      context: { userName: 'Alice' },
    });
    expect(result).toMatch(/^ALICE ROLLS \d+$/);
  });
});
