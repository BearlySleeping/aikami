// packages/frontend/ai-gateway/src/lib/decision/analyzer.ts
//
// Pure schema → decision-plan compiler (issue #381, contract C-566).
//
// Two properties matter more than coverage:
//
//  1. **Nothing is ever discarded to reach compatibility.** A keyword the
//     compiler does not fully understand is a rejection, not a warning. A
//     schema that means more than the plan enforces would otherwise be
//     reported as "compatible" and produce a value the original schema
//     refuses — the worst possible failure for a permission-shaped decision.
//  2. **Structural compatibility is not a routing decision.** This function
//     answers only "may these questions be asked at all?". Whether the task
//     is *suitable* is answered separately, by `bindDecisionPolicy`.
//
// The compiler is deterministic: the same schema always yields the same plan,
// with keys that do not depend on property or option declaration order.

import {
  DEFAULT_DECISION_LIMITS,
  type DecisionAnalysis,
  type DecisionConstant,
  type DecisionIncompatibility,
  type DecisionLimits,
  type DecisionLiteral,
  type DecisionPlan,
  type DecisionQuestion,
  type DecisionQuestionGroup,
} from './types.ts';
import { questionKeyFor, safeSegment, schemaFingerprint } from './util.ts';

/**
 * Compiler version. Part of the plan cache key, so shipping any change to the
 * rules below invalidates every cached plan without a manual purge.
 */
export const DECISION_COMPILER_VERSION = 'decision-compiler/1.0.0';

/** A fully resolved schema node. */
type CompiledNode =
  | { readonly kind: 'constant'; readonly value: DecisionLiteral; readonly description?: string }
  | { readonly kind: 'boolean'; readonly description?: string }
  | {
      readonly kind: 'choice';
      readonly options: readonly DecisionLiteral[];
      readonly description?: string;
    }
  | {
      readonly kind: 'object';
      readonly fields: ReadonlyMap<string, CompiledNode>;
      readonly description?: string;
    };

/** Outcome of compiling one node. */
type NodeResult =
  | { readonly ok: true; readonly node: CompiledNode }
  | { readonly ok: false; readonly reasons: DecisionIncompatibility[] };

/** Compiler state for one analysis run. */
type CompileContext = {
  readonly limits: DecisionLimits;
  /** Root `$defs` / `definitions`, resolved once per analysis. */
  readonly definitions: Record<string, unknown>;
};

/**
 * Keywords the compiler understands everywhere.
 *
 * Anything outside this set is a rejection. This is the mechanism behind rule
 * (1): an unrecognised keyword cannot be quietly ignored, because there is no
 * code path that skips it.
 */
const KNOWN_KEYWORDS: ReadonlySet<string> = new Set([
  '$comment',
  '$defs',
  '$id',
  '$ref',
  '$schema',
  'additionalProperties',
  'anyOf',
  'const',
  'definitions',
  'description',
  'enum',
  'properties',
  'required',
  'title',
  'type',
]);

/**
 * Keywords tolerated alongside a `$ref`.
 *
 * `description` and `title` are documentation. Anything else — including
 * `default`, `examples`, and sibling constraints — would narrow the referenced
 * schema in ways the plan does not enforce.
 */
const REF_ANNOTATION_KEYWORDS: ReadonlySet<string> = new Set([
  '$comment',
  '$ref',
  'description',
  'title',
]);

/** Property names that must never be written through an assignment. */
const UNSAFE_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

/** Ref pointers currently being resolved, threaded through the compile walk. */
type RefTrail = readonly string[];

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isLiteral = (value: unknown): value is DecisionLiteral =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

/** Canonical ordering for a literal's type tag. */
const literalTypeTag = (value: DecisionLiteral): string =>
  typeof value === 'number' ? 'number' : typeof value;

/** Canonical sort key for a literal, independent of declaration order. */
const literalSortKey = (value: DecisionLiteral): string =>
  `${literalTypeTag(value)}:${String(value)}`;

/** Builds a single-reason failure. */
const fail = (
  code: DecisionIncompatibility['code'],
  path: readonly string[],
  detail: string,
): NodeResult => ({ ok: false, reasons: [{ code, path, detail }] });

/**
 * Reads the schema-authored description of a node.
 *
 * Only `description` is honoured: `title` is often a machine identifier, and
 * treating an identifier as an instruction is exactly the failure this module
 * exists to prevent.
 */
const nodeDescription = (node: Record<string, unknown>): string | undefined => {
  const description = node.description;
  return typeof description === 'string' && description.trim().length > 0
    ? description.trim()
    : undefined;
};

/**
 * Rejects any keyword outside {@link KNOWN_KEYWORDS}.
 *
 * Returns the offending keys so the reason names the constraint that was
 * refused rather than just saying "unsupported".
 */
const rejectUnknownKeywords = (
  node: Record<string, unknown>,
  path: readonly string[],
): DecisionIncompatibility[] => {
  const unknown = Object.keys(node).filter((key) => !KNOWN_KEYWORDS.has(key));
  if (unknown.length === 0) {
    return [];
  }
  return [
    {
      code: 'unsupported-constraint',
      path,
      detail: `constraint(s) not implemented by the decision compiler: ${unknown.sort().join(', ')}`,
    },
  ];
};

/**
 * Validates a collected literal set and returns the matching node.
 *
 * A set mixing string and number values is rejected rather than coerced: the
 * reconstruction would have to guess a type the schema never chose.
 */
const finishChoice = (
  literals: readonly DecisionLiteral[],
  path: readonly string[],
  description?: string,
): NodeResult => {
  const distinct = [...new Set(literals)];
  if (distinct.length === 0) {
    return fail('empty-choice', path, 'choice has no distinct literal values');
  }
  const tags = new Set(distinct.map(literalTypeTag));
  if (tags.size > 1) {
    return fail(
      'mixed-choice-types',
      path,
      `choice mixes literal types (${[...tags].sort().join(', ')}); options must be homogeneous`,
    );
  }
  if (distinct.length === 1) {
    return {
      ok: true,
      node: { kind: 'constant', value: distinct[0] as DecisionLiteral, description },
    };
  }
  if (
    distinct.length === 2 &&
    tags.has('boolean') &&
    distinct.includes(true) &&
    distinct.includes(false)
  ) {
    return { ok: true, node: { kind: 'boolean', description } };
  }
  return {
    ok: true,
    node: {
      kind: 'choice',
      options: distinct.sort((left, right) =>
        literalSortKey(left).localeCompare(literalSortKey(right)),
      ),
      description,
    },
  };
};

/** Resolves a local `#/$defs/<name>` or `#/definitions/<name>` pointer. */
const resolveLocalRef = (options: {
  pointer: string;
  context: CompileContext;
  trail: RefTrail;
  path: readonly string[];
}): NodeResult => {
  const modern = '#/$defs/';
  const legacy = '#/definitions/';
  const isModern = options.pointer.startsWith(modern);
  if (!isModern && !options.pointer.startsWith(legacy)) {
    return fail(
      'external-reference',
      options.path,
      `only local #/$defs/ and #/definitions/ pointers are supported; got ${options.pointer}`,
    );
  }
  if (options.trail.includes(options.pointer)) {
    return fail(
      'circular-reference',
      options.path,
      `reference cycle: ${[...options.trail, options.pointer].join(' -> ')}`,
    );
  }
  const name = options.pointer.slice((isModern ? modern : legacy).length);
  const target = options.context.definitions[name];
  if (!isPlainObject(target)) {
    return fail(
      'external-reference',
      options.path,
      `unresolvable local reference ${options.pointer}`,
    );
  }
  return compileNode(target, options.path, options.context, [...options.trail, options.pointer]);
};

/**
 * Classifies one `anyOf` branch as a usable literal, or explains the refusal.
 *
 * Branches of a literal union carry no nested structure, so no reference
 * resolution or recursion is needed here — only `const` and the empty shape
 * are accepted.
 */
const branchLiteral = (
  branch: unknown,
  path: readonly string[],
):
  | { readonly ok: true; readonly literal: DecisionLiteral }
  | { readonly ok: false; readonly reasons: DecisionIncompatibility[] } => {
  const refuse = (
    code: DecisionIncompatibility['code'],
    detail: string,
  ): { ok: false; reasons: DecisionIncompatibility[] } => ({
    ok: false,
    reasons: [{ code, path, detail }],
  });
  if (!isPlainObject(branch)) {
    return refuse('unsupported-root-kind', `union branch must be an object, got ${typeof branch}`);
  }
  if (branch.type === 'null') {
    return refuse('nullable-field', 'null is not a decision primitive');
  }
  if (!('const' in branch)) {
    return refuse(
      'unsupported-property-type',
      'union branch is not a literal; arbitrary values are not compiled',
    );
  }
  if (branch.const === null) {
    return refuse('nullable-field', 'null is not a decision primitive');
  }
  if (!isLiteral(branch.const)) {
    return refuse('unsupported-constraint', 'const must be a string, number or boolean');
  }
  return { ok: true, literal: branch.const };
};

/** Compiles the branches of an `anyOf`, which must all be plain literals. */
const compileAnyOf = (
  node: Record<string, unknown>,
  path: readonly string[],
  context: CompileContext,
  trail: RefTrail,
): NodeResult => {
  const branches = node.anyOf;
  if (!Array.isArray(branches) || branches.length === 0) {
    return fail('unsupported-constraint', path, 'anyOf must be a non-empty array of schemas');
  }
  if (branches.length > context.limits.maxUnionBranches) {
    return fail(
      'union-branch-limit-exceeded',
      path,
      `union has ${branches.length} branches; limit is ${context.limits.maxUnionBranches}`,
    );
  }

  const literals: DecisionLiteral[] = [];
  const reasons: DecisionIncompatibility[] = [];
  for (const [index, branch] of branches.entries()) {
    const branchPath = [...path, `[${index}]`];
    const classified = branchLiteral(branch, branchPath);
    if (!classified.ok) {
      // An object variant is refused with its OWN reasons rather than a generic
      // one: `CombatIntentDraftSchema` fails because its `steps` are arrays, and
      // that is far more useful to the caller than "union of objects".
      if (classified.reasons.every((reason) => reason.code === 'unsupported-property-type')) {
        const compiled = compileNode(branch, branchPath, context, trail);
        if (!compiled.ok) {
          reasons.push(...compiled.reasons);
          continue;
        }
      }
      reasons.push(...classified.reasons);
      continue;
    }
    literals.push(classified.literal);
  }

  if (reasons.length > 0) {
    return { ok: false, reasons };
  }
  return finishChoice(literals, path, nodeDescription(node));
};

/** Validates the shape of an object's `properties` / `required` pair. */
const readObjectShape = (
  node: Record<string, unknown>,
  path: readonly string[],
):
  | { readonly ok: true; properties: Record<string, unknown>; requiredNames: ReadonlySet<string> }
  | { readonly ok: false; readonly reasons: DecisionIncompatibility[] } => {
  if (node.additionalProperties !== false) {
    return {
      ok: false,
      reasons: [
        {
          code: 'open-record',
          path,
          detail:
            'object must set additionalProperties: false; an open record has no bounded option set',
        },
      ],
    };
  }
  const properties = node.properties;
  if (!isPlainObject(properties)) {
    return {
      ok: false,
      reasons: [
        { code: 'unsupported-constraint', path, detail: 'object must declare a properties map' },
      ],
    };
  }
  // JSON Schema defaults `required` to empty, and TypeBox omits the key when
  // every property is optional. Treat an absent list as empty so those schemas
  // report `optional-field`, which is the reason that actually matters.
  const required = node.required ?? [];
  if (!Array.isArray(required) || required.some((entry) => typeof entry !== 'string')) {
    return {
      ok: false,
      reasons: [
        {
          code: 'unsupported-constraint',
          path,
          detail: 'required must be an array of property names when present',
        },
      ],
    };
  }
  const missing = (required as string[]).find((name) => !Object.hasOwn(properties, name));
  if (missing !== undefined) {
    return {
      ok: false,
      reasons: [
        {
          code: 'unsupported-constraint',
          path,
          detail: `required property ${missing} has no schema`,
        },
      ],
    };
  }
  return { ok: true, properties, requiredNames: new Set(required as string[]) };
};

/** Compiles one property of an object, returning its field entry or its reasons. */
const compileProperty = (options: {
  name: string;
  schema: unknown;
  path: readonly string[];
  context: CompileContext;
  trail: RefTrail;
  depth: number;
  requiredNames: ReadonlySet<string>;
}):
  | { readonly ok: true; entry: readonly [string, CompiledNode] }
  | { readonly ok: false; reasons: DecisionIncompatibility[] } => {
  const propertyPath = [...options.path, options.name];
  if (UNSAFE_PROPERTY_NAMES.has(options.name)) {
    return {
      ok: false,
      reasons: [
        {
          code: 'unsafe-property-name',
          path: propertyPath,
          detail: `property name ${options.name} is not addressable`,
        },
      ],
    };
  }
  if (!options.requiredNames.has(options.name)) {
    return {
      ok: false,
      reasons: [
        {
          code: 'optional-field',
          path: propertyPath,
          detail:
            'optional and nullable fields are not compiled; absence is not a decision primitive',
        },
      ],
    };
  }
  const compiled = compileNode(
    options.schema,
    propertyPath,
    options.context,
    options.trail,
    options.depth,
  );
  return compiled.ok
    ? { ok: true, entry: [options.name, compiled.node] as const }
    : { ok: false, reasons: compiled.reasons };
};

/** Compiles the properties/required/additionalProperties triple. */
const compileObject = (
  node: Record<string, unknown>,
  path: readonly string[],
  context: CompileContext,
  trail: RefTrail,
  depth: number,
): NodeResult => {
  const description = nodeDescription(node);
  if (depth > context.limits.maxDepth) {
    return fail('depth-limit-exceeded', path, `nesting depth exceeds ${context.limits.maxDepth}`);
  }

  const shape = readObjectShape(node, path);
  if (!shape.ok) {
    return shape;
  }

  const fields = new Map<string, CompiledNode>();
  const reasons: DecisionIncompatibility[] = [];
  // Sorted so property declaration order cannot change the compiled plan.
  for (const name of Object.keys(shape.properties).sort()) {
    const outcome = compileProperty({
      name,
      schema: shape.properties[name],
      path,
      context,
      trail,
      depth: depth + 1,
      requiredNames: shape.requiredNames,
    });
    if (outcome.ok) {
      fields.set(outcome.entry[0], outcome.entry[1]);
      continue;
    }
    reasons.push(...outcome.reasons);
  }

  if (reasons.length > 0) {
    return { ok: false, reasons };
  }
  if (fields.size === 0) {
    return { ok: true, node: { kind: 'constant', value: true, description } };
  }
  return { ok: true, node: { kind: 'object', fields, description } };
};

/**
 * Refuses a node whose declared type has no decision primitive, before any
 * keyword is inspected.
 *
 * `enum`/`const` are exempt: a finite set of strings, numbers or booleans IS
 * the primitive. A node is rejected either way, so running this first only
 * changes which reason the caller sees — nothing is dropped.
 */
const refuseUnsupportedType = (
  node: Record<string, unknown>,
  path: readonly string[],
): NodeResult | undefined => {
  if ('enum' in node || 'const' in node) {
    return undefined;
  }
  const declaredType = node.type;
  if (declaredType === 'null') {
    return fail('nullable-field', path, 'null is not a decision primitive');
  }
  if (declaredType === 'array' || 'items' in node) {
    return fail('unsupported-array', path, 'arrays have no bounded per-call answer shape');
  }
  if (declaredType === 'string' || declaredType === 'number' || declaredType === 'integer') {
    return fail(
      'unsupported-property-type',
      path,
      `arbitrary ${declaredType} values are not decision primitives; use a finite enum`,
    );
  }
  return undefined;
};

/** Resolves a node carrying a `$ref`, refusing sibling narrowing. */
const compileRef = (
  node: Record<string, unknown>,
  path: readonly string[],
  context: CompileContext,
  trail: RefTrail,
): NodeResult => {
  const siblingKeys = Object.keys(node).filter((key) => !REF_ANNOTATION_KEYWORDS.has(key));
  if (siblingKeys.length > 0) {
    return fail(
      'unsupported-constraint',
      path,
      `$ref may not be narrowed by sibling keyword(s): ${siblingKeys.sort().join(', ')}`,
    );
  }
  return resolveLocalRef({ pointer: String(node.$ref), context, trail, path });
};

/** Compiles a literal-valued node: `const` or `enum`. */
const compileLiteral = (node: Record<string, unknown>, path: readonly string[]): NodeResult => {
  if ('const' in node) {
    if (node.const === null) {
      return fail('nullable-field', path, 'null is not a decision primitive');
    }
    if (!isLiteral(node.const)) {
      return fail('unsupported-constraint', path, 'const must be a string, number or boolean');
    }
    return {
      ok: true,
      node: { kind: 'constant', value: node.const, description: nodeDescription(node) },
    };
  }
  const values = node.enum;
  if (!Array.isArray(values)) {
    return fail('unsupported-constraint', path, 'enum must be an array');
  }
  if (values.some((value) => value === null)) {
    return fail('nullable-field', path, 'enum containing null is not a decision primitive');
  }
  if (values.some((value) => !isLiteral(value))) {
    return fail('unsupported-constraint', path, 'enum values must be strings, numbers or booleans');
  }
  return finishChoice(values as DecisionLiteral[], path, nodeDescription(node));
};

/** Compiles one schema node into a {@link CompiledNode}. */
const compileNode = (
  raw: unknown,
  path: readonly string[],
  context: CompileContext,
  trail: RefTrail,
  depth = 0,
): NodeResult => {
  if (!isPlainObject(raw)) {
    return fail(
      'unsupported-root-kind',
      path,
      `schema node must be an object, got ${Array.isArray(raw) ? 'array' : typeof raw}`,
    );
  }

  const unsupportedType = refuseUnsupportedType(raw, path);
  if (unsupportedType !== undefined) {
    return unsupportedType;
  }
  if (typeof raw.$ref === 'string') {
    return compileRef(raw, path, context, trail);
  }

  // The keyword whitelist runs before any compilation so an extra constraint on
  // an otherwise fine node can never be narrowed away silently.
  const unknownReasons = rejectUnknownKeywords(raw, path);
  if (unknownReasons.length > 0) {
    return { ok: false, reasons: unknownReasons };
  }

  if ('const' in raw || 'enum' in raw) {
    return compileLiteral(raw, path);
  }
  if ('anyOf' in raw) {
    return compileAnyOf(raw, path, context, trail);
  }
  if (raw.type === 'object' || 'properties' in raw) {
    return compileObject(raw, path, context, trail, depth);
  }
  if (raw.type === 'boolean') {
    return { ok: true, node: { kind: 'boolean', description: nodeDescription(raw) } };
  }
  if (raw.type !== undefined) {
    return fail('unsupported-root-kind', path, `unsupported type keyword ${String(raw.type)}`);
  }
  return fail('unsupported-constraint', path, 'schema node constrains nothing and cannot be asked');
};

/** Flattens one compiled node into a question or a pinned constant. */
const flattenNode = (
  node: CompiledNode,
  path: readonly string[],
  questions: DecisionQuestion[],
  constants: DecisionConstant[],
): void => {
  if (node.kind === 'object') {
    for (const [name, child] of [...node.fields.entries()].sort((left, right) =>
      left[0].localeCompare(right[0]),
    )) {
      flattenNode(child, [...path, name], questions, constants);
    }
    return;
  }
  if (node.kind === 'constant') {
    constants.push({ path, value: node.value });
    return;
  }
  if (node.kind === 'boolean') {
    questions.push({
      key: questionKeyFor(path),
      path: [...path],
      kind: 'boolean',
      description: node.description,
      groupId: 'independent',
    });
    return;
  }
  questions.push({
    key: questionKeyFor(path),
    path: [...path],
    kind: 'choice',
    description: node.description,
    options: node.options.map((value, index) => ({ key: `o${index}`, value })),
    groupId: 'independent',
  });
};

/** Extracts root `$defs` / `definitions` once, for local ref resolution. */
const collectDefinitions = (root: Record<string, unknown>): Record<string, unknown> => {
  const modern = isPlainObject(root.$defs) ? root.$defs : {};
  const legacy = isPlainObject(root.definitions) ? root.definitions : {};
  return { ...legacy, ...modern };
};

/** Enforces the question and option bounds on a compiled plan. */
const enforcePlanBounds = (
  questions: readonly DecisionQuestion[],
  limits: DecisionLimits,
): DecisionIncompatibility[] => {
  const oversized = questions.filter(
    (question) => question.kind === 'choice' && (question.options?.length ?? 0) > limits.maxOptions,
  );
  if (oversized.length > 0) {
    return oversized.map((question) => ({
      code: 'option-limit-exceeded' as const,
      path: question.path,
      detail: `choice has ${question.options?.length ?? 0} options; limit is ${limits.maxOptions}`,
    }));
  }
  if (questions.length > limits.maxQuestions) {
    return [
      {
        code: 'question-limit-exceeded' as const,
        path: [],
        detail: `plan would ask ${questions.length} questions; limit is ${limits.maxQuestions}`,
      },
    ];
  }
  return [];
};

/**
 * Compiles a schema into a backend-neutral {@link DecisionPlan}, or explains
 * exactly why it cannot be compiled.
 *
 * Pure: no I/O, no clock, no global state, and no dependency on any decision
 * runtime. The returned plan carries no question text — binding semantics is a
 * separate, explicit step.
 *
 * @param options.schema - A TypeBox or JSON Schema object. Unknown shapes are
 *   rejected rather than partially compiled.
 * @param options.limits - Overrides for {@link DEFAULT_DECISION_LIMITS}.
 */
export const analyzeDecisionSchema = (options: {
  schema: unknown;
  limits?: Partial<DecisionLimits>;
}): DecisionAnalysis => {
  const limits = { ...DEFAULT_DECISION_LIMITS, ...options.limits };
  const schema = options.schema;

  if (!isPlainObject(schema)) {
    return {
      ok: false,
      reasons: [
        {
          code: 'unsupported-root-kind',
          path: [],
          detail: `root schema must be an object, got ${Array.isArray(schema) ? 'array' : typeof schema}`,
        },
      ],
    };
  }

  const context: CompileContext = { limits, definitions: collectDefinitions(schema) };
  const compiled = compileNode(schema, [], context, []);
  if (!compiled.ok) {
    return compiled;
  }

  const questions: DecisionQuestion[] = [];
  const constants: DecisionConstant[] = [];
  flattenNode(compiled.node, [], questions, constants);

  const bounds = enforcePlanBounds(questions, limits);
  if (bounds.length > 0) {
    return { ok: false, reasons: bounds };
  }

  const groups: DecisionQuestionGroup[] =
    questions.length === 0
      ? []
      : [
          {
            id: 'independent',
            questionKeys: questions.map((question) => question.key),
            dispatch: 'independent',
          },
        ];

  return {
    ok: true,
    plan: {
      compilerVersion: DECISION_COMPILER_VERSION,
      schemaFingerprint: schemaFingerprint(schema),
      questions,
      constants,
      groups,
    },
  };
};

/** Exposed so callers can reject hostile segments before building a path. */
export const isUnsafeSegment = (segment: string): boolean => !safeSegment(segment);
