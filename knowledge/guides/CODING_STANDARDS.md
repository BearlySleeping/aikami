# Coding Standards

This document outlines the coding standards for the AiKami project. Adhering to these standards ensures code consistency, readability, and maintainability across the codebase.

## General Guidelines

-   **Readability:** Code should be easy to read and understand.
-   **Maintainability:** Code should be easy to modify and extend.
-   **Consistency:** Follow existing patterns and styles within the project.
-   **Clarity:** Avoid clever or overly complex solutions when a simpler alternative exists.
-   **DRY (Don't Repeat Yourself):** Avoid duplicating code.

## TypeScript Specific Guidelines

These guidelines are primarily based on the Google TypeScript Style Guide.

### Language Features

-   **Variable Declarations:** Always use `const` or `let`. `var` is forbidden. Prefer `const` by default.
-   **Modules:** Use ES6 modules (`import`/`export`). Do not use `namespace`.
-   **Exports:** Use named exports (`export {MyClass};`). Avoid default exports.
-   **Classes:**
    -   Do not use `#private` fields. Use TypeScript's `private` visibility modifier.
    -   Mark properties never reassigned outside the constructor with `readonly`.
    -   Never use the `public` modifier (it's the default). Restrict visibility with `private` or `protected` where possible.
-   **Functions:** Prefer function declarations for named functions. Use arrow functions for anonymous functions/callbacks.
-   **String Literals:** Use single quotes (`'`). Use template literals (`` ` ``) for interpolation and multi-line strings.
-   **Equality Checks:** Always use triple equals (`===`) and not equals (`!==`).
-   **Type Assertions:** Avoid type assertions (`x as SomeType`) and non-nullability assertions (`y!`). If necessary, provide clear justification.

### Disallowed Features

-   **`any` Type:** Avoid `any`. Prefer `unknown` or a more specific type.
-   **Wrapper Objects:** Do not instantiate `String`, `Boolean`, or `Number` wrapper classes.
-   **Automatic Semicolon Insertion (ASI):** Do not rely on it. Explicitly end all statements with a semicolon.
-   **`const enum`:** Do not use `const enum`. Use plain `enum` instead.
-   **`eval()` and `Function(...string)`:** Forbidden.

### Naming

-   **`UpperCamelCase`:** For classes, interfaces, types, enums, and decorators.
-   **`lowerCamelCase`:** For variables, parameters, functions, methods, and properties.
-   **`CONSTANT_CASE`:** For global constant values, including enum values.
-   **`_` Prefix/Suffix:** Do not use `_` as a prefix or suffix for identifiers, including for private properties.

### Type System

-   **Type Inference:** Rely on type inference for simple, obvious types. Be explicit for complex types.
-   **`undefined` and `null`:** Both are supported. Be consistent within your project.
-   **Optional vs. `|undefined`:** Prefer optional parameters and fields (`?`) over adding `|undefined` to the type.
-   **`Array<T>` Type:** Use `T[]` for simple types. Use `Array<T>` for more complex union types (e.g., `Array<string | number>`).
-   **`{}` Type:** Do not use `{}`. Prefer `unknown`, `Record<string, unknown>`, or `object`.

### Comments and Documentation

-   **JSDoc:** Use `/** JSDoc */` for documentation, `//` for implementation comments.
-   **Redundancy:** Do not declare types in `@param` or `@return` blocks (e.g., `/** @param {string} user */`).
-   **Add Information:** Comments must add information, not just restate the code.

## Strict AI Coding Rules

These rules supplement the TypeScript guidelines above and were discovered during the AI service abstraction (C-015), database abstraction (C-014), and engine boundary (C-016) contracts. They apply to all **new** code written in this project.

### Type Definitions Over Interfaces

-   **Use `type` for data shapes**: Parameters, return types, option bags, discriminated unions, ECS component data — all use `type`.
-   **Use `interface` only for OOP contracts**: An `interface` is reserved for abstraction boundaries that classes implement (e.g., `EngineBridge`, `BaseDatabaseService`, `AiServiceInterface`).
-   Rationale: `type` composes better (unions, intersections, mapped types), avoids declaration merging surprises, and aligns with the functional/data-oriented architecture of the game engine and service abstractions.

```typescript
// ✅ Correct — type for data shapes
type GameCommand =
  | { type: 'MOVE_PLAYER'; direction: 'up' | 'down' | 'left' | 'right' }
  | { type: 'INTERACT'; targetEntityId: string };

type Position = { x: number; y: number };

// ✅ Correct — interface only for OOP contracts
interface EngineBridge {
  send(command: GameCommand): void;
  on<T extends GameEvent['type']>(eventType: T, handler: (event: Extract<GameEvent, { type: T }>) => void): () => void;
}

// ❌ Forbidden — interface for plain data shapes
interface Position { x: number; y: number; }
```

### Arrow Const Over Function Syntax

-   **Prefer `const` with arrow functions** for all callbacks, module-level functions, factory functions, and system functions.
-   **Reserve `function` keyword** only for generator functions (`function*`) and class method overrides where `this` binding is required.
-   Rationale: Arrow functions have lexical `this` (no binding surprises), are more concise for callbacks, and align with the `const`-by-default principle already in the project's TypeScript guidelines.

```typescript
// ✅ Correct — arrow const for module-level functions
const createPlayer = (world: World, pos: Position) => {
  const entity = world.createEntity();
  world.addComponent(entity, Position, pos);
  return entity;
};

// ✅ Correct — function reserved for generator
function* idGenerator(): Generator<number> {
  let id = 0;
  while (true) {
    yield id++;
  }
}

// ❌ Forbidden — function for non-generator module-level code
function createPlayer(world: World, pos: Position) {
  return world.createEntity();
}
```

### Explicit Braces for All Conditional Blocks

-   **Every `if`, `else if`, `else`, `for`, `while`, `do...while` body MUST be wrapped in curly braces `{}`**, even for single-statement bodies.
-   **No single-line braceless conditionals** — this includes guard clauses.
-   Rationale: Prevents dangling-else bugs, makes diffs cleaner when adding statements, and improves readability in the engine-boundary code where guard clauses are pervasive.

```typescript
// ✅ Correct
if (!bridge.isReady()) {
  return;
}

for (const entity of entities) {
  if (entity.health <= 0) {
    continue;
  }
  processEntity(entity);
}

// ❌ Forbidden
if (!bridge.isReady()) return;
for (const entity of entities) processEntity(entity);
```

### Early Loop Escapes

-   **Use guard clauses and early returns** at the top of every function/method. Validate preconditions first; return or throw before the happy path.
-   **In loops, use `continue` and `break` early** to filter out iterations that don't need processing — avoid deep nesting.
-   Rationale: The game engine systems (movement, rendering, dialog triggers) iterate over entities every frame at 60fps. Nested conditionals in tight loops cause branch-prediction penalties and reduce readability. Guard-at-the-top keeps the critical path flat.

```typescript
// ✅ Correct — guard clauses, early continue
const updateMovement = (world: World, delta: number) => {
  if (!world) {
    return;
  }

  const entities = queryMovement(world);
  for (const entity of entities) {
    const vel = world.getComponent(entity, Velocity);
    if (!vel || (vel.x === 0 && vel.y === 0)) {
      continue;
    }

    const pos = world.getComponent(entity, Position);
    if (!pos) {
      continue;
    }

    pos.x += vel.x * delta;
    pos.y += vel.y * delta;
  }
};

// ❌ Forbidden — deeply nested, no early escapes
const updateMovement = (world: World, delta: number) => {
  if (world) {
    const entities = queryMovement(world);
    for (const entity of entities) {
      const vel = world.getComponent(entity, Velocity);
      if (vel && (vel.x !== 0 || vel.y !== 0)) {
        const pos = world.getComponent(entity, Position);
        if (pos) {
          pos.x += vel.x * delta;
          pos.y += vel.y * delta;
        }
      }
    }
  }
};
```
