---
name: project-commands
description: Aikami monorepo commands reference — moon tasks, validation, deployment scripts, CI, and package.json shortcuts.
---

# Project Commands

## Moon Project Configuration

Every project in the monorepo **must** have a `moon.yml` that follows this standard:

```yaml
# packages/{project}/moon.yml
$schema: "https://moonrepo.dev/schemas/project.json"

language: "typescript"
layer: "library" # or 'application', 'tool'
tags:
    - "{project}"
    - "shared"
    - "library"

project:
    title: "{Title}"
    description: "{Description}."
    channel: "#frontend"
    owner: "Frontend Team"

fileGroups:
    sources:
        - "src/**/*"
    configs:
        - "package.json"
        - "tsconfig.json"
    tests:
        - "tests/**/*"

tasks:
    typecheck:
        command: "bun run typecheck"
        inputs:
            - "@group(sources)"
            - "@group(configs)"

    format:
        command: "bun run format"
        inputs:
            - "@group(sources)"
            - "@group(configs)"

    lint:
        command: "bun run lint"
        inputs:
            - "@group(sources)"
            - "@group(configs)"

    test:
        command: "bun run test"
        inputs:
            - "@group(sources)"
            - "@group(tests)"
            - "@group(configs)"

    fix:
        command: "bun run fix"
        inputs:
            - "@group(sources)"
            - "@group(configs)"

    dev:
        command: "bun run dev"
        inputs:
            - "@group(sources)"
            - "@group(configs)"
        options:
            runFromWorkspaceRoot: false

    build:
        command: "bun run build"
        inputs:
            - "@group(sources)"
            - "@group(configs)"
        options:
            runFromWorkspaceRoot: false
```

### Key Rules

1. **All tasks use `bun run <script>`** - Never call binaries directly
2. **All scripts must be in `package.json`** - Moon delegates to package.json scripts
3. **Use `@group()` references** - Reference fileGroups for inputs
4. **`runFromWorkspaceRoot: false`** for dev/build - Run in project dir, not workspace root
5. **Standard tasks**: `typecheck`, `format`, `lint`, `test`, `fix`, `dev`, `build`
6. **No `validate` task** - The combined `typecheck && test` task has been removed

---

## Root-Level Scripts

The root `package.json` provides shortcuts for common operations:

### Development

| Script            | Command                                    | Purpose                                                      |
| ----------------- | ------------------------------------------ | ------------------------------------------------------------ |
| `dev`             | `moon run $APP:dev`                        | Start dev server for $APP                                    |
| `dev:all`         | `moon run root:dev-all`                    | Start full stack (emulator + PWA + vm-controller + ZeroClaw) |
| `emulate:backend` | `bunx moon run functions:emulate`          | Firebase Functions emulator                                  |
| `emulate:pwa`     | `bunx moon run pwa:dev -- --mode emulator` | PWA in emulator mode                                         |
| `emulate:podman`  | `bunx moon run vm-controller:emulate`      | VM Controller with Podman                                    |

### Validation (Run Separately)

**AI agents: always use the `:affected` variants.**

| Script              | Command                          | Purpose                    |
| ------------------- | -------------------------------- | -------------------------- |
| `fix`               | `moon run :fix`                  | Fix all projects           |
| `fix:affected`      | `moon run :fix --affected`       | Fix affected only          |
| `typecheck`         | `moon run :typecheck`            | Typecheck all projects     |
| `typecheck:affected` | `moon run :typecheck --affected` | Typecheck affected only    |
| `test`              | `moon run $APP:test`             | Run tests (single app)     |
| `test:affected`     | `moon run :test --affected`      | Test all affected          |
| `lint`              | `moon run :lint`                 | Lint all projects          |
| `lint:affected`     | `moon run :lint --affected`      | Lint affected only         |
| `format`            | `moon run :format`               | Check formatting           |
| `format:affected`   | `moon run :format --affected`    | Format affected only       |
| `format:write`      | Write formatting fixes           |                            |

### Setup (One-Time)

| Script               | Command                                 | Purpose                       |
| -------------------- | --------------------------------------- | ----------------------------- |
| `setup`              | `bun run scripts/setup/project.ts`      | Interactive project bootstrap |
| `setup:firebase`     | `bun run scripts/setup/firebase.ts`     | Firebase config setup         |
| `setup:gmail-oauth`  | `bun run scripts/setup/gmail_oauth.ts`  | Gmail OAuth setup             |
| `setup:gmail-client` | `bun run scripts/setup/gmail_client.ts` | Store OAuth credentials       |

### Operations (Daily)

| Script         | Command                                 | Purpose               |
| -------------- | --------------------------------------- | --------------------- |
| `ops:secrets`  | `bun run scripts/ops/upload_secrets.ts` | Upload secrets to GCP |
| `ops:add-user` | `bun run scripts/ops/add_user.ts`       | Add user to GCP IAM   |
| `ops:dev-all`  | `bun run scripts/ops/dev_all.ts`        | Start dev-all stack   |

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
