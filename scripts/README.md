# @aikami/scripts

Monorepo scripts for CI, setup, developer onboarding, and operations.

## Use Case

This package provides CLI scripts shared across the Aikami monorepo:

- **Ops** — Dev server orchestration, environment setup, cleanup
- **Deploy** — Deployment pipelines and configuration
- **Setup** — Local machine setup (direnv, bun, jdk, chromium, tauri deps) + GCP project setup
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

### Setup (`src/lib/local_setup/`)

Local machine setup — interactive CLI guide that checks for essential tools
(bun, git), optional DX (direnv, nix, pi, herdr), emulator dependencies
(jdk, chromium), and Tauri build dependencies (Rust, webkit2gtk, …).
Prints copy-paste install commands for the detected platform.

```bash
bun run setup
```

### Project Setup (`src/lib/project_setup/`)

🔴 GCP cloud infrastructure setup — NOT local machine setup. Orchestrates
GCP APIs, IAM roles, Secret Manager, Firebase Hosting sites, Artifact
Registry, and CDN hosting for the Aikami cloud project.

```bash
bun run project:setup                      # Full interactive wizard
bun run project:setup --mode=staging       # Target specific mode
bun run project:setup:iam                  # IAM roles only
```

### Testing (`src/lib/test_blackbox/`)

Blackbox integration test runner harness.
