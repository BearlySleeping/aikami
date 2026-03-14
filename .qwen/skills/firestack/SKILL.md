---
name: firestack
description: CLI tool for building, testing, and deploying Firebase Cloud Functions. Use when you need to deploy functions, start emulators, run maintenance scripts, or manage Firestore/Storage rules.
---

# Firestack Skill

This skill provides the workflow and knowledge needed to effectively use the Firestack CLI for Firebase Cloud Functions development.

## Core Workflows

### 1. Configuration (`firestack.json`)
Before running any commands, ensure a `firestack.json` exists in the project root.
- **Reference**: See [configuration.md](references/configuration.md) for all options and schema setup.

### 2. Emulation
Use `firestack emulate` for local development.
- **Auto-Open**: Use `--open` to open the Emulator UI automatically.
- **Initialization**: Create an `on_emulate.ts` script in the `scripts` directory to seed data.
- **Smart Emulators**: Firestack auto-detects needed emulators (auth, firestore, pubsub, storage). Explicitly set them with `--emulators auth,firestore` if needed.

### 3. Deployment
Use `firestack deploy` to push changes to Firebase.
- **Flavors**: Always specify a flavor (e.g., `--flavor development`).
- **Dry Run**: Use `--dry-run` to see what will be deployed without making changes.
- **Parallelism**: Firestack uses a worker-pool for high-speed concurrent deployments.

### 4. Custom Scripts
Run any script from the `scripts` directory using `firestack scripts`.
- If no name is provided, an interactive selector will appear.
- Environments are automatically loaded from `.env.{flavor}`.

## Writing Functions
Firestack is built for Cloud Functions v2.
- **Reference**: See [triggers.md](references/triggers.md) for trigger patterns (HTTP, Callable, Firestore, Schedule, etc.).
- Always export the trigger as the **default export**.

## Managing Rules & Indexes
- Place rules in `src/rules/firestore.rules` and `src/rules/storage.rules`.
- Place indexes in `src/rules/firestore.indexes.json`.
- Deploy them using `firestack rules` or bundle them with functions using `firestack deploy --all`.

## Advanced Features
- **Differential Caching**: Firestack only deploys functions that have changed by comparing checksums.
- **Monorepo Support**: Firestack dynamically resolves dependency versions by searching parent directories.
- **Two-Phase Deploy**: Phase 1 (Plan) and Phase 2 (Execute) provide a clean summary of deployment intent.

## Commands Reference
For a complete list of commands and options, see [commands.md](references/commands.md).
