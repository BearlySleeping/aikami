# Guides

Contributor workflows and operational runbooks. For formats and interfaces, see
[`../reference/`](../reference/); for the system design, see
[`../architecture/`](../architecture/).

## Getting running

| Guide | What it covers |
|---|---|
| [`../intro/setup.md`](../intro/setup.md) | Prerequisites, first-time setup, environment config |
| [`dev-workflow.md`](dev-workflow.md) | Daily commands, dev services, hub vs hub-worker, troubleshooting |
| [`STRUCTURE.md`](STRUCTURE.md) | Monorepo map and where code lives |
| [`STACK.md`](STACK.md) | Technology stack and its migration history |

## Building and testing

| Guide | What it covers |
|---|---|
| [`CODING_STANDARDS.md`](CODING_STANDARDS.md) | TypeScript and AI-coding conventions |
| [`TESTING.md`](TESTING.md) | Test strategy, layers, and known issues |
| [`CI_CD.md`](CI_CD.md) | GitHub Actions, secrets, and release workflows |
| [`contract-pipeline.md`](contract-pipeline.md) | How contracts are drafted, implemented, verified, and merged |

## Data, content, and desktop

| Guide | What it covers |
|---|---|
| [`database.md`](database.md) | Cloudflare D1 schema, Drizzle migrations, the server data plane |
| [`catalog_workspace.md`](catalog_workspace.md) | Local catalog authoring CLI (`snapshot`/`pull`/`status`/`optimize`/`sync`) |
| [`map_studio.md`](map_studio.md) | Hub map studio — preview map manifests with the game's scene loader |
| [`TAURI.md`](TAURI.md) | Tauri dev/debug notes and platform pitfalls |
| [`TAURI_BOOT_HANDOFF.md`](TAURI_BOOT_HANDOFF.md) | Investigation handoff: asset pipeline, blank-canvas issue, measurements |
| [`FEATURES.md`](FEATURES.md) | Feature specifications and data shapes (see the status note at the top) |

## Lessons and pitfalls

| Guide | What it covers |
|---|---|
| [`cross-origin-isolation.md`](cross-origin-isolation.md) | Why COOP/COEP and SharedArrayBuffer are deliberately off |
| [`npc-interaction-dialogue.md`](npc-interaction-dialogue.md) | Svelte 5 ViewModel lifecycle and interaction-trigger lessons |
| [`worker-cloudflare-tls.md`](worker-cloudflare-tls.md) | Worker VM static-IP/TLS history and constraints |
| [`engineering-hygiene.md`](engineering-hygiene.md) | Ongoing codebase-health items |

The `C-xxx` comments throughout the code are contract citations. To look one up,
see [`../contracts/`](../contracts/).
