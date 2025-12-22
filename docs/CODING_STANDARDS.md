# Coding Standards

This document outlines the coding standards for the Aikami project. By following these standards, we can ensure that the codebase is clean, consistent, and easy to maintain.

## Guiding Principles

-   **Consistency:** Code should be consistent in style and structure across the entire project.
-   **Readability:** Code should be easy to read and understand.
-   **Simplicity:** Code should be as simple as possible, without sacrificing functionality or performance.

## Linting

We use [**XO**](https://github.com/xojs/xo) as our primary linter. XO is a highly opinionated linter that enforces a strict set of rules, which helps to ensure consistency and readability.

We also use the [**unicorn**](https://github.com/sindresorhus/eslint-plugin-unicorn) ESLint plugin, which provides a set of additional rules for writing better code.

### Configuration

The linting configuration is defined in the `deno.json` file. To run the linter, use the following command:

```bash
deno lint
```

### Rules

We use the default XO rules, with a few minor modifications. The full set of rules can be found in the `deno.json` file.

Here are some of the key rules that we follow:

-   **Semicolons:** We do not use semicolons.
-   **Indentation:** We use 2 spaces for indentation.
-   **Quotes:** We use single quotes for strings.
-   **Trailing commas:** We use trailing commas for multiline arrays and objects.
-   **Naming conventions:** We use camelCase for variables and functions, and PascalCase for classes and types.

For a complete list of rules, please refer to the [XO documentation](https://github.com/xojs/xo#rules) and the [unicorn documentation](https://github.com/sindresorhus/eslint-plugin-unicorn#rules).

## Formatting

We use the `deno fmt` command to format our code. This ensures that the code is always formatted consistently.

To format the code, use the following command:

```bash
deno fmt
```

## Type Checking

We use TypeScript for all our code. This helps to ensure that the code is type-safe and free of errors.

To run the type checker, use the following command:

```bash
deno check
```

## Git

### Commits

We follow the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) specification for our commit messages. This helps to ensure that our commit history is clean, consistent, and easy to read.

A commit message consists of a **header**, a **body**, and a **footer**.

The header has a special format that includes a **type**, a **scope**, and a **subject**:

```
<type>(<scope>): <subject>
```

The **type** must be one of the following:

-   `feat`: A new feature
-   `fix`: A bug fix
-   `docs`: Documentation only changes
-   `style`: Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc)
-   `refactor`: A code change that neither fixes a bug nor adds a feature
-   `perf`: A code change that improves performance
-   `test`: Adding missing tests or correcting existing tests
-   `build`: Changes that affect the build system or external dependencies (example scopes: gulp, broccoli, npm)
-   `ci`: Changes to our CI configuration files and scripts (example scopes: Travis, Circle, BrowserStack, SauceLabs)
-   `chore`: Other changes that don't modify `src` or `test` files
-   `revert`: Reverts a previous commit

The **scope** is optional and can be used to specify the part of the codebase that is affected by the change.

The **subject** contains a succinct description of the change.

### Branches

We use the following branching strategy:

-   `main`: The main branch. This branch should always be stable and deployable.
-   `develop`: The development branch. This branch is where we merge our feature branches.
-   `feat/...`: Feature branches. These branches are used to develop new features.
-   `fix/...`: Bug fix branches. These branches are used to fix bugs.
-   `docs/...`: Documentation branches. These branches are used to write documentation.

## Conclusion

By following these coding standards, we can ensure that the Aikami project is a success. If you have any questions or suggestions, please feel free to open an issue or a pull request.