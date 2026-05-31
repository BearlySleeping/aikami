// packages/shared/parser/tests/parser.test.ts
//
// Unit tests for the macro & slash command parser.
// Covers: slash commands, macro extraction, stream chunking, Zod validation.

import { describe, expect, test } from "bun:test";
import {
  createStreamBuffer,
  extractMacros,
  flushStreamBuffer,
  hasUnclosedMacro,
  parseLine,
  parseStreamChunk,
  stripMacros,
  tokenizeLine,
} from "../src/index.ts";

// =============================================================================
// Slash command extraction
// =============================================================================

describe("tokenizeLine — slash commands", () => {
  test("/roll 1d20 → CommandNode", () => {
    const tokens = tokenizeLine("/roll 1d20");
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe("command");
    if (tokens[0].type === "command") {
      expect(tokens[0].command).toBe("roll");
      expect(tokens[0].args).toEqual(["1d20"]);
      expect(tokens[0].raw).toBe("/roll 1d20");
    }
  });

  test("/move 10 10 → CommandNode", () => {
    const tokens = tokenizeLine("/move 10 10");
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe("command");
    if (tokens[0].type === "command") {
      expect(tokens[0].command).toBe("move");
      expect(tokens[0].args).toEqual(["10", "10"]);
    }
  });

  test("/roll 2d6+3 → args contain the whole expression", () => {
    const tokens = tokenizeLine("/roll 2d6+3");
    expect(tokens).toHaveLength(1);
    if (tokens[0].type === "command") {
      expect(tokens[0].command).toBe("roll");
      expect(tokens[0].args).toEqual(["2d6+3"]);
    }
  });

  test("/move 0 -5 → negative args preserved", () => {
    const tokens = tokenizeLine("/move 0 -5");
    expect(tokens).toHaveLength(1);
    if (tokens[0].type === "command") {
      expect(tokens[0].command).toBe("move");
      expect(tokens[0].args).toEqual(["0", "-5"]);
    }
  });

  test("/custom-cmd flag1 flag2 → hyphenated command name", () => {
    const tokens = tokenizeLine("/custom-cmd flag1 flag2");
    expect(tokens).toHaveLength(1);
    if (tokens[0].type === "command") {
      expect(tokens[0].command).toBe("custom-cmd");
      expect(tokens[0].args).toEqual(["flag1", "flag2"]);
    }
  });

  test("/noargs → command with empty args", () => {
    const tokens = tokenizeLine("/noargs");
    expect(tokens).toHaveLength(1);
    if (tokens[0].type === "command") {
      expect(tokens[0].command).toBe("noargs");
      expect(tokens[0].args).toEqual([]);
    }
  });

  test("bare / → falls through as TextNode (no command name)", () => {
    const tokens = tokenizeLine("/");
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe("text");
    if (tokens[0].type === "text") {
      expect(tokens[0].content).toBe("/");
    }
  });
});

describe("tokenizeLine — plain text", () => {
  test("regular text → TextNode", () => {
    const tokens = tokenizeLine("Hello, world!");
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe("text");
    if (tokens[0].type === "text") {
      expect(tokens[0].content).toBe("Hello, world!");
    }
  });

  test("empty string → empty array", () => {
    const tokens = tokenizeLine("");
    expect(tokens).toEqual([]);
  });

  test("whitespace-only string → empty array", () => {
    const tokens = tokenizeLine("   ");
    expect(tokens).toEqual([]);
  });

  test("slash mid-sentence → treated as text, not command", () => {
    const tokens = tokenizeLine("I like /roll dice");
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe("text");
    if (tokens[0].type === "text") {
      expect(tokens[0].content).toContain("/roll");
    }
  });
});

// =============================================================================
// Macro extraction
// =============================================================================

describe("extractMacros", () => {
  test("{{anim:attack_01}} in middle of text → single MacroNode", () => {
    const macros = extractMacros("*swings sword* {{anim:attack_01}}");
    expect(macros).toHaveLength(1);
    expect(macros[0].type).toBe("macro");
    expect(macros[0].name).toBe("anim");
    expect(macros[0].args).toEqual(["attack_01"]);
  });

  test("multiple macros in one string → all extracted", () => {
    const macros = extractMacros(
      "{{anim:attack}} and {{trigger_anim:defend,quick}}",
    );
    expect(macros).toHaveLength(2);
    expect(macros[0].name).toBe("anim");
    expect(macros[0].args).toEqual(["attack"]);
    expect(macros[1].name).toBe("trigger_anim");
    expect(macros[1].args).toEqual(["defend", "quick"]);
  });

  test("macro with no args → empty args array", () => {
    const macros = extractMacros("{{pause}}");
    expect(macros).toHaveLength(1);
    expect(macros[0].name).toBe("pause");
    expect(macros[0].args).toEqual([]);
  });

  test("macro with colon but no args after → empty args array", () => {
    const macros = extractMacros("{{skill:}}");
    expect(macros).toHaveLength(1);
    expect(macros[0].name).toBe("skill");
    expect(macros[0].args).toEqual([]);
  });

  test("text without macros → empty array", () => {
    const macros = extractMacros("Just ordinary text.");
    expect(macros).toEqual([]);
  });

  test("{{roll:1d20}} → dice macro", () => {
    const macros = extractMacros("You deal {{roll:1d20}} damage!");
    expect(macros).toHaveLength(1);
    expect(macros[0].name).toBe("roll");
    expect(macros[0].args).toEqual(["1d20"]);
  });

  test("{{trigger_anim:attack}} → macro with underscore in name", () => {
    const macros = extractMacros("{{trigger_anim:attack}}");
    expect(macros).toHaveLength(1);
    expect(macros[0].name).toBe("trigger_anim");
    expect(macros[0].args).toEqual(["attack"]);
  });
});

describe("stripMacros", () => {
  test("strips single macro from text", () => {
    const result = stripMacros("*swings sword* {{anim:attack_01}}");
    expect(result).toBe("*swings sword* ");
  });

  test("strips multiple macros", () => {
    const result = stripMacros(
      "{{anim:attack}} and {{trigger_anim:defend}}",
    );
    expect(result).toBe(" and ");
  });

  test("no macros → unchanged", () => {
    const result = stripMacros("Just ordinary text.");
    expect(result).toBe("Just ordinary text.");
  });
});

// =============================================================================
// hasUnclosedMacro
// =============================================================================

describe("hasUnclosedMacro", () => {
  test("detects unclosed {{", () => {
    expect(hasUnclosedMacro("Some text {{anim:")).toBe(true);
  });

  test("detects plain {{ without colon", () => {
    expect(hasUnclosedMacro("Hello {{world")).toBe(true);
  });

  test("closed macro → false", () => {
    expect(hasUnclosedMacro("{{anim:attack}}")).toBe(false);
  });

  test("no braces → false", () => {
    expect(hasUnclosedMacro("Plain text")).toBe(false);
  });

  test("only closing → false", () => {
    expect(hasUnclosedMacro("text}}")).toBe(false);
  });
});

// =============================================================================
// parseLine
// =============================================================================

describe("parseLine", () => {
  test("/roll 1d20 → command is non-null", () => {
    const result = parseLine("/roll 1d20");
    expect(result.command).not.toBeNull();
    expect(result.command?.command).toBe("roll");
    expect(result.command?.args).toEqual(["1d20"]);
    expect(result.nodes).toHaveLength(1);
  });

  test("plain text → command is null", () => {
    const result = parseLine("Hello!");
    expect(result.command).toBeNull();
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].type).toBe("text");
  });
});

// =============================================================================
// Stream chunking
// =============================================================================

describe("parseStreamChunk — streaming", () => {
  test("complete macro in single chunk → resolved immediately", () => {
    const buf = createStreamBuffer();
    const result = parseStreamChunk("Hello {{anim:wave}}!", buf);

    expect(result.displayText).toBe("Hello !");
    expect(result.macros).toHaveLength(1);
    expect(result.macros[0].name).toBe("anim");
    expect(result.macros[0].args).toEqual(["wave"]);
    expect(result.pending).toBe(false);
    expect(buf.buffer).toBe("");
  });

  test("partial macro across chunks → deferred resolution", () => {
    const buf = createStreamBuffer();

    // Chunk 1: opening brace and partial macro
    const r1 = parseStreamChunk("Hello {{anim:", buf);
    expect(r1.displayText).toBe("");
    expect(r1.macros).toEqual([]);
    expect(r1.pending).toBe(true);
    expect(buf.buffer).toBe("Hello {{anim:");

    // Chunk 2: rest of macro
    const r2 = parseStreamChunk("attack_01}} there", buf);
    // Macro stripped → "Hello  there" (double space where macro was)
    expect(r2.displayText).toBe("Hello  there");
    expect(r2.macros).toHaveLength(1);
    expect(r2.macros[0].name).toBe("anim");
    expect(r2.macros[0].args).toEqual(["attack_01"]);
    expect(r2.pending).toBe(false);
    expect(buf.buffer).toBe("");
  });

  test("three-way split: {{, then name, then args}}", () => {
    const buf = createStreamBuffer();

    // "{{"
    const r1 = parseStreamChunk("text {{", buf);
    expect(r1.pending).toBe(true);
    expect(r1.displayText).toBe("");

    // "macro_name:"
    const r2 = parseStreamChunk("macro_name:", buf);
    expect(r2.pending).toBe(true);
    expect(r2.displayText).toBe("");

    // "args}} more text"
    const r3 = parseStreamChunk("args}} more text", buf);
    expect(r3.pending).toBe(false);
    expect(r3.displayText).toBe("text  more text");
    expect(r3.macros).toHaveLength(1);
    expect(r3.macros[0].name).toBe("macro_name");
    expect(r3.macros[0].args).toEqual(["args"]);
  });

  test("two separate macros in stream → both resolved", () => {
    const buf = createStreamBuffer();

    const r1 = parseStreamChunk("You {{anim:slash}} and {{sfx:clang}}!", buf);
    expect(r1.pending).toBe(false);
    expect(r1.macros).toHaveLength(2);
    expect(r1.macros[0].name).toBe("anim");
    expect(r1.macros[1].name).toBe("sfx");
    expect(r1.displayText).toBe("You  and !");
  });

  test("no macros → display text unchanged", () => {
    const buf = createStreamBuffer();
    const result = parseStreamChunk("Hello, world!", buf);

    expect(result.displayText).toBe("Hello, world!");
    expect(result.macros).toEqual([]);
    expect(result.pending).toBe(false);
    expect(buf.buffer).toBe("");
  });

  test("multiple chunks with no macros → all emitted", () => {
    const buf = createStreamBuffer();

    const r1 = parseStreamChunk("Hello,", buf);
    expect(r1.displayText).toBe("Hello,");
    expect(buf.emitted).toBe("Hello,");

    const r2 = parseStreamChunk(" world!", buf);
    expect(r2.displayText).toBe(" world!");
    expect(buf.emitted).toBe("Hello, world!");
  });
});

describe("flushStreamBuffer", () => {
  test("empty buffer → no output", () => {
    const buf = createStreamBuffer();
    const result = flushStreamBuffer(buf);
    expect(result.displayText).toBe("");
    expect(result.macros).toEqual([]);
    expect(result.pending).toBe(false);
  });

  test("mid-macro flush → returns remaining as text (malformed input)", () => {
    const buf = createStreamBuffer();
    buf.buffer = "Hello {{anim:att";

    const result = flushStreamBuffer(buf);
    expect(result.displayText).toBe("Hello {{anim:att");
    expect(result.macros).toEqual([]);
    expect(result.pending).toBe(false);
    expect(buf.buffer).toBe("");
  });
});

// =============================================================================
// Zod validation — reject invalid shapes
// =============================================================================

describe("Zod validation — rejects invalid tokens", () => {
  test("empty macro name is not extracted", () => {
    const macros = extractMacros("{{}}");
    expect(macros).toEqual([]);
  });
});
