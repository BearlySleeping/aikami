---
name: tdd-workflow
description: Mandates Blackbox and Unit Testing workflow before writing implementation code.
---

# TDD Workflow

Aikami is built on strict Test-Driven Development (TDD). You MUST follow this workflow when implementing any feature or fixing a bug.

## 1. Write the Test First
Before writing implementation code, you must define the acceptance criteria in code.
- For Unit/Logic: Create a `.test.ts` file next to the implementation using `bun test`.
- For Backend/E2E: Add a test to the Playwright suites in `scripts/src/lib/test_blackbox/suites/`.

## 2. Watch it Fail
- Run the test suite and verify that your new test fails.
- Command for E2E: `bun run test:blackbox [suite-name]`
- Command for Unit: `bun test [path-to-file]`

## 3. Write the Implementation
- Implement the feature using the strict rules defined in `aikami-standards`.
- Keep the implementation simple and strictly focused on passing the test.

## 4. Verify it Passes
- Re-run the tests. Ensure that not only your new test passes, but you haven't broken any existing tests.
- Run `bunx biome check .` to ensure your new code passes the strict formatter and linter rules.

## 5. Blackbox Emulators
If your test involves Firebase or the Dev Server, use the blackbox scripts to ensure a clean environment.
- The `test:blackbox` script automatically starts emulators and the necessary dev servers via tmux/direnv.
- Do NOT try to mock Firebase services unless explicitly testing an abstraction layer. We test against the real emulators.
