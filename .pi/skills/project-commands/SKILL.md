---
name: project-commands
description: Aikami monorepo commands reference — moon tasks, validation, deployment scripts, CI, and package.json shortcuts.
---

# Project Commands

> **See `aikami-conventions` for**: direnv environment, mode switching, PWA dev server defaults, logger alias.
>
> This skill covers moon configs, root scripts, commit directives, and tmux.

---

## 🔴 Agent Task Execution Guidelines

These rules govern how AI agents spawn commands for this project.

### 1. Long-Running Processes → Tmux

**Always prefer `bun run tmux:start <service>` for processes that stay alive**
(dev servers, emulators, watchers). Never use `moon_run_task client:dev` or
`moon_run_task image:dev` — these start foreground processes that block the
agent indefinitely.

```bash
# ✅ CORRECT — background tmux session
bun run tmux:start client          # Client dev server in tmux
bun run tmux:start all             # Full stack
bun run tmux:start firebase        # Firebase emulators

# ❌ WRONG — foreground dev server blocks agent
bun moon run client:dev
```

After starting a tmux session, wait 3-5 seconds then use `browser_inspect` to
verify the page is accessible.

### 2. Finite Tasks → Set Timeout & Predict Duration

For `moon_run_task` and `bash` commands that should complete within a finite
time, **always provide a `timeout` value**. Default to **5 minutes (300s)**
unless you have a concrete reason to expect a different duration.

```bash
# ✅ CORRECT — timeout provided
bash("npm test 2>&1", timeout=300)
moon_run_task("pwa:build", timeout=600)   # longer for build

# ❌ WRONG — no timeout, may hang forever
bash("npm test 2>&1")
```

| Task Type   | Default Timeout | Notes                   |
| ----------- | --------------- | ----------------------- |
| Fix / Lint  | 120s            | Fast static analysis    |
| Typecheck   | 180s            | Slower but bounded      |
| Test (unit) | 300s            | Default 5 minutes       |
| Build       | 600s            | Bundling can be slow    |
| Test (E2E)  | 600s            | Includes server startup |

### 3. Tmux Session Lifecycle

```bash
# Check what's already running
bun run tmux:status

# Start (only if not already running)
bun run tmux:start client
bun run tmux:start all --force     # Kill + recreate

# Join to inspect
bun run tmux:join firebase

# Cleanup when done
bun run tmux:stop client
```

---

## Moon Project Configuration

The monorepo has **inherited default tasks** in `.moon/tasks/all.yml` that every project gets automatically:

| Inherited Task | Delegates To                          | When to Override                                          |
| -------------- | ------------------------------------- | --------------------------------------------------------- |
| `lint`         | `bun run lint`                        | Never — already maps to `biome lint .`                    |
| `format`       | `bun run format`                      | Never — already maps to `biome format .`                  |
| `typecheck`    | `bun run typecheck`                   | Never — already maps to `tsgo --noEmit`                   |
| `fix`          | `bun run fix`                         | Never — already maps to `biome check --write .`           |
| `validate`     | `~:lint` + `~:format` + `~:typecheck` | Never — internal meta-task, do NOT define in package.json |

Do NOT define these tasks in your project's `moon.yml`. They are inherited for free.

### Pattern A — Pure Library (no custom tasks)

```yaml
# packages/{project}/moon.yml
$schema: "https://moonrepo.dev/schemas/project.json"

language: "typescript"
layer: "library"
tags:
    - "{project}"
    - "{domain}"
    - "library"

project:
    name: "{project-id}" # moon key, e.g. "backend-auth"
    description: "{Description}."
    channel: "#frontend"
    owner: "Frontend Team"

dependsOn:
    - "constants"
    - "types"
```

No `fileGroups` or `tasks` sections — all inherited.

### Pattern B — Library with tests

```yaml
# packages/{project}/moon.yml
$schema: "https://moonrepo.dev/schemas/project.json"

language: "typescript"
layer: "library"
tags:
    - "{project}"
    - "{domain}"
    - "library"

project:
    name: "{project-id}"
    description: "{Description}."
    channel: "#frontend"
    owner: "Frontend Team"

dependsOn:
    - "constants"
    - "types"

fileGroups:
    tests:
        - "tests/**/*"

tasks:
    test:
        command: "bun run test"
        inputs:
            - "@group(sources)"
            - "@group(tests)"
            - "@group(configs)"
```

Only the `test` task is defined — you can reference `@group(sources)` and `@group(configs)` from the inherited file groups.

### Pattern C — App with dev server / build / E2E tests

```yaml
# apps/{project}/moon.yml
$schema: "https://moonrepo.dev/schemas/project.json"

language: "typescript"
layer: "application"
tags:
    - "{project}"
    - "{domain}"
    - "application"

project:
    name: "{project-id}"
    description: "{Description}."
    channel: "#frontend"
    owner: "Frontend Team"

dependsOn:
    - "constants"
    - "types"

toolchains:
    javascript: false # use this if the app bundles its own deps (Vite, Astro)

fileGroups:
    sources:
        - "src/**/*"
        - "index.html"
    configs:
        - "package.json"
        - "tsconfig.json"
        - "vite.config.*"
    tests:
        - "tests/**/*"
        - "playwright.config.*"
    unitTests:
        - "src/**/*.test.ts"

tasks:
    dev:
        command: "bun run dev"
        preset: "server"
    build:
        command: "bun run build"
        inputs:
            - "@group(sources)"
            - "@group(configs)"
        outputs:
            - "dist"
    preview:
        command: "bun run preview"
        preset: "server"
    test:
        script: |
            bun run build && bun run preview & PID=$!; sleep 5; bun run test; RESULT=$?; kill $PID 2>/dev/null || true; exit $RESULT
        deps:
            - "build"
        inputs:
            - "@group(tests)"
            - "@group(sources)"
    test-unit:
        command: "bun run test:unit"
        inputs:
            - "@group(unitTests)"
            - "@group(sources)"
    test-e2e:
        script: "bun run build && bun run preview & PID=$!; sleep 5; bun run test; RESULT=$?; kill $PID 2>/dev/null || true; exit $RESULT"
        deps:
            - "build"
        inputs:
            - "@group(tests)"
            - "@group(sources)"
```

### Key Rules

1. **Tasks that are inherited** (`lint`, `format`, `typecheck`, `fix`, `validate`) must NOT be redefined in moon.yml or duplicated in fileGroups
2. **Custom file groups** only need entries NOT already covered by the inherited groups (`sources`, `configs`, `tests`, `root-configs`, `deployment`, `assets`)
3. **Custom tasks can reference** `@group(sources)`, `@group(configs)`, `@group(root-configs)` freely — they exist in the inherited groups
4. **All tasks delegate to `bun run <script>`** — scripts must be defined in `package.json`
5. **Use `preset: "server"`** for long-running dev servers (moon won't cache them)
6. **Use `toolchains: javascript: false`** when the app uses its own bundler (Vite, Astro, etc.)
7. **Use `project.name` not `project.title`** — the name is the moon key (e.g. `backend-auth`)

---

## Root-Level Scripts

The root `package.json` provides shortcuts for common operations:

### Development

| Script    | Command                                  | Purpose                                                  |
| --------- | ---------------------------------------- | -------------------------------------------------------- |
| `dev`     | `moon run $APP:dev`                      | Start dev server for $APP (defaults to emulator for PWA) |
| `dev:all` | `bun run scripts/src/lib/ops/dev_all.ts` | Start full stack in tmux (mode from $AIKAMI_MODE)        |

| Tmux Script     | Command                                    | Purpose                                                     |
| --------------- | ------------------------------------------ | ----------------------------------------------------------- |
| `tmux:start`    | `bun run scripts/src/lib/tmux/start.ts`    | Start a tmux session (firebase/client/image/text/voice/all) |
| `tmux:join`     | `bun run scripts/src/lib/tmux/join.ts`     | Attach to a running tmux session                            |
| `tmux:stop`     | `bun run scripts/src/lib/tmux/stop.ts`     | Stop a tmux session                                         |
| `tmux:stop-all` | `bun run scripts/src/lib/tmux/stop_all.ts` | Stop all aikami tmux sessions                               |
| `tmux:status`   | `bun run scripts/src/lib/tmux/status.ts`   | List running aikami tmux sessions                           |

### Validation (Run Separately)

**AI agents: always use the `:affected` variants.**

| Script               | Command                          | Purpose                 |
| -------------------- | -------------------------------- | ----------------------- |
| `fix`                | `moon run :fix`                  | Fix all projects        |
| `fix:affected`       | `moon run :fix --affected`       | Fix affected only       |
| `typecheck`          | `moon run :typecheck`            | Typecheck all projects  |
| `typecheck:affected` | `moon run :typecheck --affected` | Typecheck affected only |
| `test`               | `moon run $APP:test`             | Run tests (single app)  |
| `test:affected`      | `moon run :test --affected`      | Test all affected       |
| `lint`               | `moon run :lint`                 | Lint all projects       |
| `lint:affected`      | `moon run :lint --affected`      | Lint affected only      |
| `format`             | `moon run :format`               | Check formatting        |
| `format:affected`    | `moon run :format --affected`    | Format affected only    |
| `format:write`       | Write formatting fixes           |                         |

### Setup (One-Time)

| Script               | Command                                 | Purpose                       |
| -------------------- | --------------------------------------- | ----------------------------- |
| `setup`              | `bun run scripts/setup/project.ts`      | Interactive project bootstrap |
| `setup:firebase`     | `bun run scripts/setup/firebase.ts`     | Firebase config setup         |
| `setup:gmail-oauth`  | `bun run scripts/setup/gmail_oauth.ts`  | Gmail OAuth setup             |
| `setup:gmail-client` | `bun run scripts/setup/gmail_client.ts` | Store OAuth credentials       |

### Operations (Daily)

| Script         | Command                                  | Purpose                  |
| -------------- | ---------------------------------------- | ------------------------ |
| `ops:secrets`  | `bun run scripts/ops/upload_secrets.ts`  | Upload secrets to GCP    |
| `ops:add-user` | `bun run scripts/ops/add_user.ts`        | Add user to GCP IAM      |
| `ops:dev-all`  | `bun run scripts/src/lib/ops/dev_all.ts` | Start full stack in tmux |

### Logging

| Script                | Command                                        | Purpose            |
| --------------------- | ---------------------------------------------- | ------------------ |
| `logs:functions`      | `bun run scripts/ops/logs.ts functions`        | View function logs |
| `logs:functions:tail` | `bun run scripts/ops/logs.ts functions --tail` | Tail function logs |
| `logs:pwa`            | `bun run scripts/ops/logs.ts pwa`              | View PWA logs      |
| `logs:pwa:tail`       | `bun run scripts/ops/logs.ts pwa --tail`       | Tail PWA logs      |
| `logs:landing`        | `bun run scripts/ops/logs.ts landing`          | View landing logs  |
| `logs:landing:tail`   | `bun run scripts/ops/logs.ts landing --tail`   | Tail landing logs  |

### CI / Build

| Script     | Command                                                 | Purpose                 |
| ---------- | ------------------------------------------------------- | ----------------------- |
| `ci`       | `moon ci`                                               | Run Moon CI             |
| `build`    | `moon run $APP:build`                                   | Build $APP              |
| `preview`  | `moon run $APP:preview`                                 | Preview built $APP      |
| `coverage` | `bun run test && bun run scripts/ops/merge_coverage.ts` | Run tests with coverage |

### Dependency Management

| Script        | Command                                                       | Purpose              |
| ------------- | ------------------------------------------------------------- | -------------------- |
| `deps:update` | `syncpack update --dependency-types prod,dev --target latest` | Update deps          |
| `deps:sync`   | `syncpack fix --dependency-types prod,dev`                    | Sync dep versions    |
| `deps:check`  | `syncpack lint --dependency-types prod,dev`                   | Check dep mismatches |

### Cleanup

| Script      | Command                                                  | Purpose             |
| ----------- | -------------------------------------------------------- | ------------------- |
| `clean`     | `rm -rf node_modules`                                    | Remove node_modules |
| `clean:all` | `rm -rf node_modules .svelte-kit dist build .moon/cache` | Deep clean          |

### Utility

| Script          | Command               | Purpose                       |
| --------------- | --------------------- | ----------------------------- |
| `dep-graph`     | `moon project-graph`  | View project dependency graph |
| `action-graph`  | `moon action-graph`   | View action graph             |
| `affected`      | `moon run --affected` | Run affected tasks            |
| `moon:check`    | `moon check`          | Check moon configuration      |
| `moon:sync`     | `moon sync`           | Sync moon projects            |
| `moon:projects` | `moon query projects` | List all projects             |

---

## Commit Message Directives

Pushing commits with these directives in the commit message controls what gets deployed:

| Directive      | Effect                                                    |
| :------------- | :-------------------------------------------------------- |
| `[only <app>]` | Deploy only specified app(s), ignoring affected detection |
| `[skip <app>]` | Skip specified app(s) even if affected                    |
| `[skip all]`   | Skip all deployments                                      |
| `[deploy all]` | Deploy all apps regardless of changes (Alias: `[force]`)  |

---

## Pre-Commit Workflow

Lefthook runs the following on staged files:

```yaml
pre-commit:
    commands:
        fix:
            run: moon run :fix:affected --status=staged
        typecheck:
            run: moon run :typecheck:affected --status=staged
```

To manually run the same checks:

```bash
# Fix and typecheck only staged files (via package.json scripts)
bun run fix:affected -- --status=staged
bun run typecheck:affected -- --status=staged

# Fix and typecheck all affected files
bun run fix:affected
bun run typecheck:affected
```

---

## Debugging & Testing

### Debugging Workflow

**Code-first debugging.** Most issues are solved by reading source files, tmux logs, and
checking the Firestore emulator data. Browser tools are a LAST resort — they are expensive
in tokens and time.

#### Debugging Priority (use in order)

| Priority | Tool                 | When to use                                      |
| -------- | -------------------- | ------------------------------------------------ |
| 1        | `read` source files  | Always — understand the code FIRST               |
| 2        | `tmux_session read`  | Check live server logs for errors                |
| 3        | `firestore_query`    | Verify data state in the emulator                |
| 4        | `browser_inspect`    | UI rendering bug, 404, blank page, env var check |
| 5        | `browser_console`    | Evidence of a JS runtime error in the browser    |
| 6        | `browser_network`    | Specific hypothesis about a failing API call     |
| 7        | `browser_screenshot` | User asks to see the page, or final verification |

#### Browser Tool Rules

1. **`browser_inspect`** — Most useful browser tool. Use ONCE with a focused `selector`.
   It exposes `PUBLIC_*` env vars in the DOM, which is invaluable for diagnosing
   wrong-env or wrong-app issues. Do NOT inspect the same page repeatedly.

2. **`browser_console`** — Only after browser_inspect, and only when you have reason to
   believe JS errors are happening (blank page, broken UI). The output is a buffer of
   intercepted console.\* calls; one call is enough.

3. **`browser_network`** — Only when you have a SPECIFIC hypothesis about a failing API
   call. Does NOT capture Firestore gRPC traffic — only XHR/fetch/WebSocket.
   A single capture with appropriate `durationMs` is sufficient.

4. **`browser_screenshot`** — Only when the user explicitly asks to see the page, or
   for one final verification after a fix. Do NOT screenshot during debugging.

5. **`browser_lighthouse`** — Specialized audit tool. Only use when the user asks about
   performance or accessibility specifically.

#### Common Patterns

```bash
# Pattern: "Something is broken in the client"
# Step 1: Check what's actually running
bash: ss -tlnp | grep <port>
# Step 2: Read the server logs
tmux_session read client
# Step 3: Check the DOM once
browser_inspect app=client selector="body"
# Step 4: Read relevant source files based on findings

# Pattern: "API call is failing"
# Step 1: Read the service/repository code
# Step 2: Check tmux logs for backend errors
# Step 3: browser_network ONLY if the call is XHR/fetch (not Firestore gRPC)
# Step 4: Read security rules if permission errors suspected
```

### Diagnostic scripts (create instead of asking user to run commands)

```bash
# Write custom debug scripts, test locally, capture output
bun run /tmp/debug_foo.ts
```

### Local service tests

```bash
# Test VM controller endpoint
curl -s http://localhost:3000/health

# Test webhook locally (simulate Telegram)
bun run scripts -- test-webhook

# Test Firestore trigger locally
bun test apps/backend/functions/src/controllers/firestore/**/*.ts
```

### Blackbox tests

```bash
bun run test:blackbox
bun run test:blackbox functions
bun run test:blackbox vm-controller --no-cross-service
```

### Debugging loop prevention

The AI enforces: 2 failed attempts → diagnostic script. Never ask user to "try again" without gathering data first.

---

## Visual Testing (AI Visual Assessment Framework)

### 🔴 Architecture: Bun Runner (visual) vs Playwright (functional)

Two separate testing systems — do NOT mix them:

| System | Runtime | Purpose | Location |
|--------|---------|---------|----------|
| **AI Visual Runner** | Bun | Screenshot capture + AI evaluation | `apps/e2e/src/visual/` |
| **Playwright** | Node.js | Behavioral/functional E2E tests | `apps/e2e/tests/` |

**Rule**: Playwright has `setup`, `client`, `game` projects. No `client-visual`.
Visual tests live in `suites/*.visual.ts`, not `tests/*.visual.spec.ts`.

### AI Visual Runner Quick Start

```bash
# Capture + evaluate all suites (requires OPENROUTER_API_KEY for eval)
cd apps/e2e && bun run test:visual

# Capture only (no API calls, just screenshots)
cd apps/e2e && bun run src/visual/runner.ts --capture-only

# Evaluate only (requires existing screenshots in test-results/visual/)
cd apps/e2e && bun run src/visual/runner.ts --eval-only

# Run a specific suite
cd apps/e2e && bun run src/visual/runner.ts --suite=map
```

### Creating a New Visual Test Suite

Use `defineConfig` + `export default` pattern. Place in `apps/e2e/src/visual/suites/`:

```typescript
// apps/e2e/src/visual/suites/my_feature.visual.ts
import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

const MySchema = Type.Object({
  score: Type.Number({ description: '0-100 score' }),
  elementVisible: Type.Boolean(),
  issues: Type.Array(Type.String()),
});

export default defineConfig({
  id: 'my-feature',
  route: '/dev/my-sandbox',                    // SvelteKit route
  waitCondition: 'game_ready',                  // 'pixi_loaded' | 'game_ready'
  requiresAuth: false,                          // inject .auth/user.json if true
  cases: [
    {
      name: 'Default State',
      searchParams: { state: 'default' },       // appended as ?state=default
      prompt: 'Describe what the AI should evaluate...',
      schema: MySchema,
      canvasSelector: 'canvas',                 // CSS selector for clip region
      clipSize: 256,                            // clip region size in px
      setupHook: async (page) => {              // optional Playwright interaction
        await page.locator('button').click();
      },
    },
  ],
});
```

### Suite Properties Reference

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | `string` | ✅ | Unique suite ID, used for `--suite=` filter |
| `route` | `string` | ✅ | SvelteKit route path (e.g. `/dev/sandbox/map`) |
| `waitCondition` | `'pixi_loaded' \| 'game_ready'` | ✅ | How to detect page readiness |
| `requiresAuth` | `boolean` | — | Inject Playwright auth state (default: false) |
| `cases[].name` | `string` | ✅ | Human-readable case name |
| `cases[].prompt` | `string` | ✅ | AI evaluation prompt |
| `cases[].schema` | `TSchema` | ✅ | TypeBox schema for validation |
| `cases[].searchParams` | `Record<string,string>` | — | URL query parameters |
| `cases[].canvasSelector` | `string` | — | CSS selector for clip (default: 'canvas') |
| `cases[].clipSize` | `number` | — | Clip region size (default: 256) |
| `cases[].setupHook` | `(page: Page) => Promise<void>` | — | Interactive Playwright setup before capture |

### Framework Architecture

```
apps/e2e/src/visual/
├── runner.ts              # CLI entry — load suites → capture → evaluate → report
├── core/
│   ├── config.ts          # defineConfig() helper
│   ├── capture.ts         # Playwright orchestration (sequential, WebGL-safe)
│   ├── evaluate.ts        # OpenRouter + TypeBox Value.Check()
│   ├── cache.ts           # SHA-256 hash cache (.visual-cache.json)
│   └── report.ts          # Static HTML report generation
└── suites/
    ├── boot_diagnostics.visual.ts
    ├── combat.visual.ts
    ├── lpc.visual.ts
    ├── map.visual.ts
    └── sandbox.visual.ts
```

### Cache

Cache lives at `apps/e2e/.visual-cache.json` (committed to Git). Key = SHA-256
of (base64Image + prompt + stringified schema). Cache hits skip OpenRouter entirely.
Only stores hash→JSON result — no base64 image data.

### Concurrency

Evaluations are chunked into groups of 5 to avoid OpenRouter 429 rate limits.
Capture is always sequential to protect the WebGL rendering context.

### Path Aliases

| Alias | Maps to |
|-------|---------|
| `$visual/*` | `apps/e2e/src/visual/*` |
| `$pom` | `apps/e2e/src/pom/index.ts` |
| `$pom/*` | `apps/e2e/src/pom/*` |
| `$utils/*` | `apps/e2e/tests/utils/*` |

---

## E2E Testing (Playwright Functional)

### Project Structure

```
apps/e2e/
├── playwright.config.ts    # 3 projects: setup, client, game
├── src/
│   ├── auth.setup.ts       # Per-worker auth state generation
│   ├── config.ts           # EMULATOR_PORTS, getWorkerProjectId()
│   ├── emulator_helper.ts  # clearAllWorkerProjects()
│   ├── fixtures.ts         # Shared test fixtures (guestUser, etc.)
│   ├── global_setup.ts     # Pre-suite emulator purge (all workers)
│   ├── global_teardown.ts  # Post-suite emulator purge (all workers)
│   └── pom/                # Page Object Models
│       ├── index.ts        # Barrel exports
│       ├── combat_page.ts  # Combat UI interactions
│       ├── inventory_page.ts # Inventory overlay
│       ├── client_auth_page.ts
│       ├── client_chat_page.ts
│       ├── client_navigation.ts
│       └── game_menu_page.ts
└── tests/
    ├── client/             # PWA functional tests (*.spec.ts)
    ├── game/               # Game engine tests (*.spec.ts)
    └── ai-services/        # AI microservice tests
```

### Creating E2E Tests

**Use POMs — no inline `page.locator()` calls.** Import from `$pom`:

```typescript
// apps/e2e/tests/client/my_feature.spec.ts
import { test } from '@playwright/test';
import { CombatPage } from '$pom';

test.describe('My Feature', () => {
  let combat: CombatPage;

  test.beforeEach(async ({ page }) => {
    combat = new CombatPage(page);
    await combat.gotoDev();
  });

  test('should do something', async () => {
    await combat.clickAttack();
    await combat.expectLogContains('hits for');
  });
});
```

### New POM

When creating a new POM, follow this pattern:

```typescript
// apps/e2e/src/pom/my_page.ts
import type { Page } from '@playwright/test';

export class MyPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ── Navigation ──
  async goto(): Promise<void> { /* ... */ }

  // ── Locators (getters, not stored) ──
  get myElement() { return this.page.locator('[data-testid="my-element"]'); }

  // ── Actions ──
  async clickSomething(): Promise<void> { await this.myElement.click(); }

  // ── Assertions (lazy import expect to keep POM test-framework-agnostic) ──
  async expectVisible(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.myElement).toBeVisible();
  }
}
```

Then add to `apps/e2e/src/pom/index.ts` barrel export.

### Running

```bash
# Run all Playwright tests
cd apps/e2e && bun run test

# Run client-only
cd apps/e2e && bun run test:client

# Run game-only (requires client dev server + game engine)
cd apps/e2e && bun run test:game

# Run visual (AI framework)
cd apps/e2e && bun run test:visual

# Generate auth states (needed before client tests)
# Auth states are cached in .auth/user-worker-{N}.json
# Run auth setup via moon:
bun moon run e2e:test  # setup runs automatically as dep of client project
```

### Worker Isolation (C-183)

- Each Playwright worker uses a distinct Firebase project ID: `demo-aikami-worker-{0..3}`
- Auth states are per-worker: `.auth/user-worker-{0..3}.json`
- Global setup/teardown purges ALL worker projects via emulator REST API
- `MAX_WORKERS = 4` in `config.ts` — increase if running more parallel workers

---

## Running Dev Servers in Tmux

All tmux sessions use a unified naming convention: `aikami-{mode}-{service}`.

| Variable  | Values                                                |
| --------- | ----------------------------------------------------- |
| `mode`    | `emulator`, `staging`, `production`                   |
| `service` | `firebase`, `client`, `image`, `text`, `voice`, `all` |

### Root package.json scripts

| Script                         | Purpose                      |
| ------------------------------ | ---------------------------- |
| `bun run tmux:start <service>` | Start a session (background) |
| `bun run tmux:join <service>`  | Attach to a running session  |
| `bun run tmux:stop <service>`  | Stop a session               |
| `bun run tmux:stop-all`        | Stop all aikami sessions     |
| `bun run tmux:status`          | List all running sessions    |

All scripts respect `$AIKAMI_MODE` from direnv. Override with `--mode <mode>`.
Use `--force` with `tmux:start` to kill and recreate an existing session.

### Quick reference

```bash
# Start services (mode from $AIKAMI_MODE, defaults to emulator)
bun run tmux:start firebase          # Firebase emulators only
bun run tmux:start client            # Client dev server
bun run tmux:start image             # Image generation (ComfyUI Docker)
bun run tmux:start text              # Text generation (Ollama Docker)
bun run tmux:start voice             # Voice synthesis (Kokoro TTS Docker)
bun run tmux:start all               # Full stack (firebase + client + image + text + voice)

# Override mode
bun run tmux:start emulators --mode staging

# Force recreate
bun run tmux:start all --force

# Join / watch
bun run tmux:join emulators          # Attach to emulators session
bun run tmux:join all                # Attach to full stack session

# Manage
bun run tmux:status                  # List all aikami sessions
bun run tmux:stop pwa                # Stop PWA session
bun run tmux:stop-all                # Stop everything

# Direct tmux commands also work
tmux attach -t aikami-emulator-all
tmux kill-session -t aikami-emulator-emulators
```

### Blackbox testing

Blackbox tests automatically use the unified tmux manager. Sessions are named
`aikami-emulator-{service}`.

```bash
# Normal run — reuses existing sessions if already running in emulator mode
bun run test:blackbox

# Force recreate all sessions from scratch
bun run test:blackbox --force

# Skip service startup entirely (sessions must already be running)
bun run test:blackbox --no-emulator
```

### How it works

The unified library (`scripts/src/lib/tmux/session.ts`) handles:

1. **Session naming**: `aikami-{mode}-{service}` stored as a tmux env var
2. **Mode detection**: Checks `AIKAMI_TMUX_MODE` env var in the session
3. **Start logic**:
    - Session doesn't exist → create new
    - Session exists, same mode → reuse (no-op)
    - Session exists, different mode → error (use `--force` to override)
4. **Command wrapping**: Uses `direnv exec . bash -c '...'` to load Nix env
5. **Keepalive**: Appends `; echo; echo '=== Stopped. Press Enter to close ==='; read`
   so the pane stays open after the command exits
