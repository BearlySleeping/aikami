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
