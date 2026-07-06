// packages/backend/ai/src/lib/agent_router.ts
/**
 * Algorithmic Token Router & AST Footprint Extractor.
 *
 * Compiles target source modules into ultra-compact type-safe footprints (.d.ts style)
 * using the TypeScript Compiler API. Maps invariant rules into static prompt blocks
 * and locks transactions to stable OpenRouter endpoints via cryptographic session IDs.
 *
 * Two primary functions:
 * 1. `extractTypeFootprint` — strips function bodies, assignments, and concrete logic
 *    from source files, retaining only type declarations, interface layouts, and exports.
 * 2. `buildRouterPayload` — constructs an OpenRouter-compatible payload with static
 *    prefix isolation and SHA-256 session_id for provider sticky routing.
 *
 * @module agent_router
 */

import { createHash } from 'node:crypto';
import ts from 'typescript';

// ── Types ──────────────────────────────────────────────────

/** A single message in an OpenRouter conversation. */
export type MessagePayload = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

/** Input to the token router for a single agent turn. */
export type RouterInput = {
  /** Human-readable description of the overall task */
  taskDescription: string;
  /** Absolute or relative paths to source files to footprint */
  sourceFilePaths: string[];
  /** Prior conversation turns */
  conversationHistory: MessagePayload[];
  /** The latest user query */
  currentQuery: string;
  /** Optional tier override (pro = thinking models, flash = fast models) */
  forceTier?: 'pro' | 'flash';
};

/** OpenRouter completion payload with session pinning. */
export type OpenRouterPayload = {
  model: string;
  messages: MessagePayload[];
  session_id: string;
  temperature: number;
  reasoning?: {
    effort: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  };
};

/** Result from footprint extraction. */
export type FootprintResult = {
  /** The compacted type-only source */
  footprint: string;
  /** Number of original lines */
  originalLines: number;
  /** Number of footprint lines */
  footprintLines: number;
  /** Reduction ratio (0-1) */
  reductionRatio: number;
};

// ── Model tier mapping ─────────────────────────────────────

const MODEL_MAP = {
  pro: 'openai/gpt-4o',
  flash: 'openai/gpt-4o-mini',
} as const;

const REASONING_MODELS = new Set(['openai/gpt-4o', 'openai/o1', 'anthropic/claude-sonnet-4']);

// ── Compiler host ──────────────────────────────────────────

/**
 * Create a minimal in-memory compiler host for footprint extraction.
 * Uses ts.readFile to load sources but never writes output files.
 */
const _createCompilerHost = (
  _fileNames: string[],
  options: ts.CompilerOptions,
): ts.CompilerHost => {
  const host = ts.createCompilerHost(options);
  const fileMap = new Map<string, string>();

  // Intercept file reads so we can track what's being compiled
  const originalReadFile = host.readFile;
  host.readFile = (fileName: string) => {
    const content = originalReadFile(fileName);
    if (content !== undefined) {
      fileMap.set(fileName, content);
    }
    return content;
  };

  host.writeFile = () => {
    // No-op — we never write output files
  };

  return host;
};

// ── Type footprint extraction ──────────────────────────────

/**
 * Strip function bodies from a source file, keeping only type-level constructs.
 *
 * Uses the TypeScript AST to identify and remove:
 * - Function/method bodies (keeps signature)
 * - Variable initializers (keeps type annotation + declaration)
 * - Class method implementations (keeps method signature)
 * - Arrow function bodies
 * - Block statements that contain implementation logic
 *
 * Retains:
 * - `import` / `export` statements
 * - `type` / `interface` declarations
 * - Function/method signatures without bodies
 * - Class property declarations
 * - JSDoc comments
 * - `export const` declarations (stripped to type-only)
 */
const _stripSourceFile = (sourceFile: ts.SourceFile): string => {
  const printer = ts.createPrinter({ removeComments: false });
  const transformed = ts.visitEachChild(sourceFile, (node) => _stripNode(node), undefined);

  return printer.printFile(transformed as ts.SourceFile);
};

/**
 * Strip a single AST node of its implementation details.
 * Returns the node as-is if it should be kept, or a modified version
 * with bodies stripped, or `undefined` to remove entirely.
 */
const _stripNode = (node: ts.Node): ts.Node | undefined => {
  // ── Remove completely ──────────────────────────────────
  // Variable statements with initializers become type-only declarations
  if (ts.isVariableStatement(node)) {
    return _stripVariableStatement(node);
  }

  // ── Strip bodies ───────────────────────────────────────
  if (ts.isFunctionDeclaration(node)) {
    return _stripFunctionDeclaration(node);
  }

  if (ts.isMethodDeclaration(node)) {
    return _stripMethodDeclaration(node);
  }

  if (ts.isArrowFunction(node)) {
    return _stripArrowFunction(node);
  }

  if (ts.isFunctionExpression(node)) {
    return _stripFunctionExpression(node);
  }

  // ── Keep all other nodes as-is ─────────────────────────
  return node;
};

/** Strip variable initializers, keeping only declarations and types. */
const _stripVariableStatement = (
  statement: ts.VariableStatement,
): ts.VariableStatement | undefined => {
  const declarations = statement.declarationList.declarations.map((decl) => {
    if (decl.initializer) {
      // Strip the initializer but keep the type annotation
      return ts.factory.createVariableDeclaration(
        decl.name,
        decl.exclamationToken,
        decl.type,
        undefined, // no initializer
      );
    }
    return decl;
  });

  // If all declarations are type-only, keep them; otherwise filter
  if (declarations.length === 0) {
    return undefined;
  }

  return ts.factory.updateVariableStatement(
    statement,
    statement.modifiers,
    ts.factory.updateVariableDeclarationList(statement.declarationList, declarations),
  );
};

/** Strip function body, keeping signature and return type. */
const _stripFunctionDeclaration = (decl: ts.FunctionDeclaration): ts.FunctionDeclaration => {
  if (!decl.body) {
    return decl; // already body-less (overload or ambient)
  }

  return ts.factory.updateFunctionDeclaration(
    decl,
    decl.modifiers,
    decl.asteriskToken,
    decl.name,
    decl.typeParameters,
    decl.parameters,
    decl.type,
    undefined, // remove body
  );
};

/** Strip method body, keeping signature and return type. */
const _stripMethodDeclaration = (method: ts.MethodDeclaration): ts.MethodDeclaration => {
  if (!method.body) {
    return method;
  }

  return ts.factory.updateMethodDeclaration(
    method,
    method.modifiers,
    method.asteriskToken,
    method.name,
    method.questionToken,
    method.typeParameters,
    method.parameters,
    method.type,
    undefined, // remove body
  );
};

/** Replace arrow function body with a void return stub. */
const _stripArrowFunction = (arrow: ts.ArrowFunction): ts.ArrowFunction => {
  // Keep the signature but replace body with void 0
  const voidBody = ts.factory.createBlock(
    [
      ts.factory.createReturnStatement(
        ts.factory.createVoidExpression(ts.factory.createNumericLiteral('0')),
      ),
    ],
    true,
  );

  return ts.factory.updateArrowFunction(
    arrow,
    arrow.modifiers,
    arrow.typeParameters,
    arrow.parameters,
    arrow.type,
    arrow.equalsGreaterThanToken,
    voidBody,
  );
};

/** Replace function expression body with void 0. */
const _stripFunctionExpression = (expr: ts.FunctionExpression): ts.FunctionExpression => {
  if (!expr.body) {
    return expr;
  }

  const voidBody = ts.factory.createBlock(
    [
      ts.factory.createReturnStatement(
        ts.factory.createVoidExpression(ts.factory.createNumericLiteral('0')),
      ),
    ],
    true,
  );

  return ts.factory.updateFunctionExpression(
    expr,
    expr.modifiers,
    expr.asteriskToken,
    expr.name,
    expr.typeParameters,
    expr.parameters,
    expr.type,
    voidBody,
  );
};

// ── Public API ─────────────────────────────────────────────

/**
 * Extract a type-only footprint from one or more source files.
 *
 * Uses the TypeScript Compiler API to parse source files, strip all
 * function bodies and variable initializers, and emit a compact
 * type-level skeleton suitable for LLM context injection.
 *
 * @returns FootprintResult with compaction statistics.
 */
export const extractTypeFootprint = (options: {
  sourceFilePaths: string[];
  /** TypeScript compiler options overrides */
  compilerOptions?: ts.CompilerOptions;
}): FootprintResult => {
  const { sourceFilePaths, compilerOptions } = options;

  const defaultOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    allowImportingTsExtensions: true,
    ...compilerOptions,
  };

  const host = _createCompilerHost(sourceFilePaths, defaultOptions);
  const program = ts.createProgram(sourceFilePaths, defaultOptions, host);

  const footprints: string[] = [];
  let totalOriginalLines = 0;

  for (const filePath of sourceFilePaths) {
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) {
      continue;
    }

    const originalText = sourceFile.getFullText();
    const originalLines = originalText.split('\n').length;
    totalOriginalLines += originalLines;

    const stripped = _stripSourceFile(sourceFile);

    // Add header indicating this is a footprint
    const header = `// [FOOTPRINT] ${filePath}\n`;
    footprints.push(header + stripped);
  }

  const footprintText = footprints.join('\n\n');
  const footprintLines = footprintText.split('\n').length;
  const reductionRatio = totalOriginalLines > 0 ? 1 - footprintLines / totalOriginalLines : 0;

  return {
    footprint: footprintText,
    originalLines: totalOriginalLines,
    footprintLines,
    reductionRatio,
  };
};

// ── C-306: Cache-aware footprint extraction ────────────────

/** Scratchpad interface subset needed for AST outline caching. */
export type AstCacheProvider = {
  getAstOutlineCache: (
    filePathKey: string,
  ) => { contentHash: string; compressedAstFootprint: string } | null;
  setAstOutlineCache: (record: {
    filePathKey: string;
    contentHash: string;
    conventionsVersion: string;
    compressedAstFootprint: string;
  }) => void;
};

/**
 * Extract type footprints with scratchpad-backed cache optimization.
 *
 * AC-2: AST Outline Cache Synchronization
 * - Computes content_hash per file
 * - Checks scratchpad cache before full TS compilation
 * - Caches newly compiled footprints for subsequent turns
 * - Preserves tool definitions frozen to maintain OpenRouter cache match
 */
export const extractTypeFootprintWithCache = (options: {
  sourceFilePaths: string[];
  compilerOptions?: ts.CompilerOptions;
  cache?: AstCacheProvider;
  conventionsVersion?: string;
}): FootprintResult & { cacheHits: number } => {
  const { sourceFilePaths, compilerOptions, cache, conventionsVersion = '1.0.0' } = options;

  const defaultOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    allowImportingTsExtensions: true,
    ...compilerOptions,
  };

  const host = _createCompilerHost(sourceFilePaths, defaultOptions);
  const program = ts.createProgram(sourceFilePaths, defaultOptions, host);

  const footprints: string[] = [];
  let totalOriginalLines = 0;
  let cacheHits = 0;

  for (const filePath of sourceFilePaths) {
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) {
      continue;
    }

    const originalText = sourceFile.getFullText();
    const originalLines = originalText.split('\n').length;
    totalOriginalLines += originalLines;

    const contentHash = createHash('sha256').update(originalText).digest('hex');

    // ── Check scratchpad cache ──────────────────────────
    if (cache) {
      const cached = cache.getAstOutlineCache(filePath);
      if (cached && cached.contentHash === contentHash) {
        // Cache hit — use frozen footprint to preserve OpenRouter prefix match
        footprints.push(`// [FOOTPRINT-CACHED] ${filePath}\n${cached.compressedAstFootprint}`);
        cacheHits++;
        continue;
      }
    }

    // ── Compile fresh footprint ─────────────────────────
    const stripped = _stripSourceFile(sourceFile);
    const header = `// [FOOTPRINT] ${filePath}\n`;
    const footprintBlock = header + stripped;

    footprints.push(footprintBlock);

    // ── Store in cache ───────────────────────────────────
    if (cache) {
      cache.setAstOutlineCache({
        filePathKey: filePath,
        contentHash,
        conventionsVersion,
        compressedAstFootprint: stripped,
      });
    }
  }

  const footprintText = footprints.join('\n\n');
  const footprintLines = footprintText.split('\n').length;
  const reductionRatio = totalOriginalLines > 0 ? 1 - footprintLines / totalOriginalLines : 0;

  return {
    footprint: footprintText,
    originalLines: totalOriginalLines,
    footprintLines,
    reductionRatio,
    cacheHits,
  };
};

// ── Tier classification ───────────────────────────────────

/**
 * Classify task description to determine pro vs flash model tier.
 */
const _classifyTier = (taskDescription: string): 'pro' | 'flash' => {
  const proPatterns = [
    /\b(refactor|restructure|architecture|migrate|rewrite)\b/i,
    /\b(complex|multi-step|pipeline|orchestrat)\b/i,
    /\bsecurity\b/i,
    /\b(performance|optimize|cache|latency)\b/i,
  ];

  if (proPatterns.some((p) => p.test(taskDescription))) {
    return 'pro';
  }

  return 'flash';
};

// ── Prompt construction ────────────────────────────────────

/**
 * Static system prompt prefix — this block is hashed for session_id pinning.
 * Must remain stable across all turns in a swarm task.
 */
const SYSTEM_CARD_BLOCK = (
  taskDescription: string,
  footprint: string,
): string => `[SYSTEM CARD — DO NOT MODIFY]
You are an expert software architecture agent operating in the Aikami monorepo.

## Task Context
${taskDescription}

## Codebase Type Footprint (TypeScript Compiler API)
The following is a type-level skeleton of the relevant source files.
Function bodies, variable initializers, and implementation logic have been stripped.
Only declarations, interfaces, types, and export signatures remain.

${footprint}

## Rules
- Follow all Aikami conventions (see aikami-conventions skill)
- Use arrow functions, type aliases (not interfaces), options objects for 2+ args
- Private members must use _ prefix
- Files must use snake_case naming
- Import from package roots, never lib/ sub-paths
- Never use +server.ts or +page.server.ts in client routes
`;

/**
 * Volatile suffix payload — appended after the static prefix.
 * Changes per turn and is NOT included in the session hash.
 */
const _volatileSuffix = (
  conversationHistory: MessagePayload[],
  currentQuery: string,
): MessagePayload[] => {
  const messages: MessagePayload[] = [];

  // Include recent conversation turns (last 10 to stay within cache window)
  const recentHistory = conversationHistory.slice(-10);
  for (const msg of recentHistory) {
    messages.push(msg);
  }

  // Append current query
  messages.push({
    role: 'user',
    content: currentQuery,
  });

  return messages;
};

// ── Public payload builder ─────────────────────────────────

/**
 * Build a complete OpenRouter completion payload with prefix isolation
 * and sticky session pinning.
 *
 * AC-2: Prompt Prefix Isolation and Sticky Session Generation
 * - Structures static type configurations first
 * - Generates a stable SHA-256 hash of the prefix block
 * - Maps hash directly to session_id for provider sticky routing
 *
 * @returns OpenRouter-compatible payload.
 */
export const buildRouterPayload = (options: {
  input: RouterInput;
  /** Pre-computed footprint from extractTypeFootprint */
  footprint: string;
  /** Optional temperature override (default: 0.3) */
  temperature?: number;
}): OpenRouterPayload => {
  const { input, footprint, temperature = 0.3 } = options;

  // ── Determine model tier ───────────────────────────────
  const tier = input.forceTier ?? _classifyTier(input.taskDescription);
  const model = MODEL_MAP[tier];

  // ── Build static prefix block ──────────────────────────
  const systemContent = SYSTEM_CARD_BLOCK(input.taskDescription, footprint);

  // ── Generate session hash from static prefix ───────────
  // Include model + system content for stable hashing
  const staticPrefix = `${model}\n${systemContent}`;
  const sessionId = createHash('sha256').update(staticPrefix).digest('hex');

  // ── Build message array ────────────────────────────────
  const messages: MessagePayload[] = [
    {
      role: 'system',
      content: systemContent,
    },
  ];

  // ── Append volatile suffix ─────────────────────────────
  const volatileMessages = _volatileSuffix(input.conversationHistory, input.currentQuery);
  messages.push(...volatileMessages);

  // ── Build reasoning config for pro-tier models ─────────
  const payload: OpenRouterPayload = {
    model,
    messages,
    session_id: sessionId,
    temperature,
  };

  if (REASONING_MODELS.has(model)) {
    payload.reasoning = { effort: tier === 'pro' ? 'medium' : 'low' };
  }

  return payload;
};

/**
 * Convenience wrapper: extract footprint + build payload in one call.
 */
export const prepareAgentPayload = (
  input: RouterInput,
  temperature?: number,
): { payload: OpenRouterPayload; footprint: FootprintResult } => {
  const footprint = extractTypeFootprint({
    sourceFilePaths: input.sourceFilePaths,
  });

  const payload = buildRouterPayload({
    input,
    footprint: footprint.footprint,
    temperature,
  });

  return { payload, footprint };
};
