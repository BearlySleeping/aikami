# @aikami/scripts

Monorepo scripts for CI, setup, developer onboarding, and operations.

## Use Case

This package provides CLI scripts shared across the Aikami monorepo:

- **Ops** — Dev server orchestration, environment setup, cleanup
- **Deploy** — Deployment pipelines and configuration
- **Setup** — Developer workspace initialization
- **Testing** — Blackbox test runner harness
- **Context** — LLM context generation and knowledge base updates

## Installation

This is a workspace package managed by moon. Install via:

```bash
bun install
```

## Dependencies

- `@aikami/constants` — Constant values
- `@aikami/schemas` — Zod schemas
- `@aikami/types` — Type definitions

## Tasks

| Task        | Command                 | Description                         |
| ----------- | ----------------------- | ----------------------------------- |
| `typecheck` | `tsgo --noEmit`         | Run TypeScript type checking        |
| `lint`      | `biome lint .`          | Lint code with Biome                |
| `format`    | `biome format .`        | Format code with Biome              |
| `fix`       | `biome check --write .` | Auto-fix lint & format issues       |
| `run`       | `bun run start`         | Run the script runner interactively |

## Usage

```bash
# Interactive mode — lists all available scripts
bun run scripts

# Direct mode — run a specific script
bun run scripts -- setup
bun run scripts -- dev
bun run scripts -- validate
bun run scripts -- generate_llms
```

## Script Categories

### Ops (`src/lib/ops/`)

| Name                  | Description                                            |
| --------------------- | ------------------------------------------------------ |
| `dev_all`             | Start all dev servers (client, docs, firebase)     |
| `validate_all`        | Run full monorepo validation (lint + typecheck + test) |
| `generate_llms`       | Generate llms.txt context file                         |
| `generate_context`    | Generate AI context from project knowledge             |
| `cleanup_vendor_dirs` | Clean up vendor directories                            |

### Deploy (`src/lib/deploy/`)

Deployment configuration for Firebase, Cloud Run, and hosting.

### Setup (`src/lib/setup/`)

Developer workspace initialization and environment setup.

### Testing (`src/lib/test_blackbox/`)

Blackbox integration test runner harness.
