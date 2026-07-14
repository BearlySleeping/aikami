---
name: project-commands
description: Aikami monorepo commands reference — moon tasks, validation, deployment scripts, CI, and package.json shortcuts.
---

# Project Commands

> **See `aikami-conventions` for**: direnv environment, mode switching, Client dev server defaults, logger alias.
>
> This skill covers moon configs, root scripts, commit directives, and herdr.

---

## 🔴 Agent Task Execution Guidelines

These rules govern how AI agents spawn commands for this project.

### 1. Long-Running Processes → Herdr

**Always prefer `bun run herdr:start <service>` for processes that stay alive**
(dev servers, firebase, watchers). Never use `moon_run_task client:dev` or
`moon_run_task image:dev` — these start foreground processes that block the
agent indefinitely.

```bash
# ✅ CORRECT — background herdr workspace
bun run herdr:start client          # Client dev server in herdr
bun run herdr:start all             # Full stack
bun run herdr:start firebase        # Firebase emulators

# ❌ WRONG — foreground dev server blocks agent
bun moon run client:dev
```

After starting a herdr workspace, wait 3-5 seconds then use `browser_inspect` to
verify the page is accessible.

### 2. Finite Tasks → Set Timeout & Predict Duration

For `moon_run_task` and `bash` commands that should complete within a finite
time, **always provide a `timeout` value**. Default to **5 minutes (300s)**
unless you have a concrete reason to expect a different duration.

```bash
# ✅ CORRECT — timeout provided
bash("npm test 2>&1", timeout=300)
moon_run_task("client:build", timeout=600)   # longer for build

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

### 3. Herdr Session Lifecycle

```bash
# Check what's already running
bun run herdr:status

# Start (only if not already running)
bun run herdr:start client
bun run herdr:start all --force     # Kill + recreate

# Join to inspect
bun run herdr:join firebase

# Cleanup when done
bun run herdr:stop client
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
| `dev`     | `moon run $APP:dev`                      | Start dev server for $APP (defaults to emulator for Client) |
| `dev:all` | `bun run scripts/src/lib/ops/dev_all.ts` | Start full stack in herdr (mode from $AIKAMI_MODE)        |

| Herdr Script     | Command                                    | Purpose                                                     |
| --------------- | ------------------------------------------ | ----------------------------------------------------------- |
| `herdr:start`    | `bun run scripts/src/lib/herdr/start.ts`    | Start a herdr workspace (firebase/client/image/text/voice/all) |
| `herdr:join`     | `bun run scripts/src/lib/herdr/join.ts`     | Attach to a running herdr workspace                            |
| `herdr:stop`     | `bun run scripts/src/lib/herdr/stop.ts`     | Stop a herdr workspace                                         |
| `herdr:stop-all` | `bun run scripts/src/lib/herdr/stop_all.ts` | Stop all aikami herdr workspaces                               |
| `herdr:status`   | `bun run scripts/src/lib/herdr/status.ts`   | List running aikami herdr workspaces                           |

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
| `ops:dev-all`  | `bun run scripts/src/lib/ops/dev_all.ts` | Start full stack in herdr |

### Logging

| Script                | Command                                        | Purpose            |
| --------------------- | ---------------------------------------------- | ------------------ |
| `logs:functions`      | `bun run scripts/ops/logs.ts functions`        | View function logs |
| `logs:functions:tail` | `bun run scripts/ops/logs.ts functions --tail` | Tail function logs |
| `logs:client`            | `bun run scripts/ops/logs.ts client`              | View Client logs      |
| `logs:client:tail`       | `bun run scripts/ops/logs.ts client --tail`       | Tail Client logs      |
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

## Commit & Push Policy

> **See `testing` skill for**: commit message directives, pre-commit workflow, push policy.

**Never commit or push without explicit instruction.** Keep changes in working tree.
After `validate()`, present a summary and ask: "Commit? Commit+push? Continue?"

## Debugging & Testing

> **See `testing` skill for**: visual testing framework, Playwright E2E, debugging workflow, test creation patterns, POM conventions, commit policy.
>
> This section covers only the root-level scripts and tools.

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

## Running Dev Servers in Herdr

All herdr workspaces use a unified naming convention: `aikami-{mode}`.

| Variable  | Values                                                |
| --------- | ----------------------------------------------------- |
| `mode`    | `emulator`, `staging`, `production`                   |
| `service` | `firebase`, `client`, `image`, `text`, `voice`, `preview-client`, `all` |

### Root package.json scripts

| Script                         | Purpose                      |
| ------------------------------ | ---------------------------- |
| `bun run herdr:start <service>` | Start a workspace (background) |
| `bun run herdr:join <service>`  | Attach to a running workspace  |
| `bun run herdr:stop <service>`  | Stop a workspace               |
| `bun run herdr:stop-all`        | Stop all aikami workspaces     |
| `bun run herdr:status`          | List all running workspaces    |

All scripts respect `$AIKAMI_MODE` from direnv. Override with `--mode <mode>`.
Use `--force` with `herdr:start` to kill and recreate an existing workspace.

### Quick reference

```bash
# Start services (mode from $AIKAMI_MODE, defaults to emulator)
bun run herdr:start firebase          # Firebase emulators only
bun run herdr:start client            # Client dev server
bun run herdr:start image             # Image generation (ComfyUI Docker)
bun run herdr:start text              # Text generation (Ollama Docker)
bun run herdr:start voice             # Voice synthesis (Kokoro TTS Docker)
bun run herdr:start all               # Full stack (firebase + client + image + text + voice)

# Override mode
bun run herdr:start firebase --mode staging

# Force recreate
bun run herdr:start all --force

# Join / watch
bun run herdr:join firebase          # Attach to firebase tab
bun run herdr:join all                # Attach to full stack workspace

# Manage
bun run herdr:status                  # List all aikami workspaces
bun run herdr:stop client                # Stop Client tab
bun run herdr:stop-all                # Stop everything

# Direct herdr commands also work
herdr attach -t aikami-emulator
herdr kill -t aikami-emulator
```

### Blackbox testing

Blackbox tests automatically use the unified herdr manager. Workspaces are named
`aikami-{mode}` (tabs named by service).

```bash
# Normal run — reuses existing sessions if already running in emulator mode
bun run test:blackbox

# Force recreate all workspaces from scratch
bun run test:blackbox --force

# Skip service startup entirely (sessions must already be running)
bun run test:blackbox --no-emulator
```

### How it works

The unified library (`scripts/src/lib/herdr/session.ts`) handles:

1. **Workspace naming**: `aikami-{mode}` stored as a herdr workspace variable
2. **Mode detection**: Checks `AIKAMI_HERDR_MODE` env var in the workspace
3. **Start logic**:
    - Workspace doesn't exist → create new
    - Workspace exists, same mode → reuse (no-op)
    - Workspace exists, different mode → error (use `--force` to override)
4. **Command wrapping**: Uses `direnv exec . bash -c '...'` to load Nix env
5. **Keepalive**: Appends `; echo; echo '=== Stopped. Press Enter to close ==='; read`
   so the pane stays open after the command exits
