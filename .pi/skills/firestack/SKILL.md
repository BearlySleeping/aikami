---
name: firestack
description: CLI for Firebase Cloud Functions (v2). Use when the user wants to deploy functions, run emulators, create new cloud functions, test security rules, or manage firestack configuration. Also triggers on phrases like "deploy to firebase", "start emulator", "create a function", "add an http endpoint", "test firestore rules", "set up firestack", or any /firestack-* slash command invocation.
user-invocable: true
argument-hint: "[{{command_hint}}] [target] [options]"
allowed-tools:
  - Bash(firestack *)
  - Bash(bun *)
  - Bash(npm *)
  - Bash(node *)
  - Read
  - Write
  - Edit
---

# Firestack Skill

Firestack is a TypeScript-first CLI for Firebase Cloud Functions v2. This skill lets the agent deploy, emulate, scaffold, test, and configure Firestack projects.

## Critical Rules

1. **One Function Per File** — Every `.ts` file in `functionsDirectory` must contain exactly one `export default` of a trigger wrapper. No named exports, no multiple functions per file.
2. **Auto-Derived Names** — The deployed function name comes from the file path: `api/hello.ts` → `hello`, `firestore/users/[uid]/created.ts` → `users_created`. Override with `functionName` in options.
3. **Always check `firestack.config.ts` (or `firestack.json`)** before running any command. If neither exists, offer to run `/firestack setup config` first.

## Command Registry

| Command | Description | Reference |
|---|---|---|
| `deploy [mode]` | Build and deploy functions/rules to Firebase | [references/deploy.md](references/deploy.md) |
| `emulate [mode]` | Start Firebase emulators with live reload | [references/emulate.md](references/emulate.md) |
| `create api <name>` | Scaffold a new HTTP function | [references/create.md](references/create.md) |
| `create callable <name>` | Scaffold a new callable function | [references/create.md](references/create.md) |
| `create firestore <path> <event>` | Scaffold a Firestore trigger | [references/create.md](references/create.md) |
| `create auth <event>` | Scaffold an Auth trigger | [references/create.md](references/create.md) |
| `create scheduler <name>` | Scaffold a scheduled function | [references/create.md](references/create.md) |
| `create storage <event>` | Scaffold a Storage trigger | [references/create.md](references/create.md) |
| `create database <ref> <event>` | Scaffold a Realtime Database trigger | [references/create.md](references/create.md) |
| `test rules` | Run Firestore/Storage security rule tests | [references/test.md](references/test.md) |
| `setup config` | Create or update `firestack.json` | [references/setup.md](references/setup.md) |
| `setup testing` | Initialize rules testing infrastructure | [references/setup.md](references/setup.md) |
| `setup emulate` | Create `scripts/on_emulate.ts` seed script | [references/setup.md](references/setup.md) |

## Routing Rules

1. **No argument or "help"** — Render the command registry table above and ask what the user wants to do.
2. **First word matches a command** — Load the corresponding reference file and follow its workflow instructions exactly.
3. **Natural language intent** — If the user says "deploy this", "start the emulator", "create an API endpoint", etc., map to the closest command and execute its workflow.
4. **Before any destructive command** — Confirm with the user. Show what will be deployed/deleted/modified.

## Global Context

When executing any Firestack command, the agent should:

1. Read `firestack.config.ts` (or `firestack.json`) to understand the project configuration.
2. Read `package.json` to check if `@snorreks/firestack` is installed.
3. Use the `functionsDirectory` (default: `src/controllers`) as the root for all function scaffolding.
4. Use the `scriptsDirectory` (default: `scripts`) for custom scripts and `on_emulate.ts`.
5. Use the `rulesDirectory` (default: `src/rules`) for rules and indexes.
6. Assume the package manager is `bun` unless `engine` or `packageManager` says otherwise.

## References

- [Deploy](references/deploy.md) — Deployment workflows
- [Emulate](references/emulate.md) — Emulator workflows
- [Create](references/create.md) — Function scaffolding
- [Test](references/test.md) — Rules testing
- [Setup](references/setup.md) — Project setup
- [Configuration](references/configuration.md) — `firestack.json` full reference
- [Triggers](references/triggers.md) — All trigger types and options
