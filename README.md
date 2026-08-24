<div align="center">

# 🗡️ Aikami

### The self-hosted AI RPG engine where every NPC thinks, remembers, and adapts.

**Chat-first roleplay has no consequences. Aikami has a d20 — and a GM that can tell you no.**

Open source · Offline-first · Bring your own key · No subscription

[![License: MIT](https://img.shields.io/github/license/BearlySleeping/aikami?color=6d28d9)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/BearlySleeping/aikami?style=social)](https://github.com/BearlySleeping/aikami/stargazers)
[![Status](https://img.shields.io/badge/status-early%20development-orange)](#project-status)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/XuuhWvSxHH)

**[🎮 Play now](https://aikami.bearlysleeping.com)** · **[💬 Discord](https://discord.gg/XuuhWvSxHH)** · **[🤝 Contributing](CONTRIBUTING.md)** · **[🐛 Issues](https://github.com/BearlySleeping/aikami/issues)**

</div>

---

## What is Aikami?

Aikami fuses tabletop D&D mechanics with LLM-driven roleplay. NPCs are
procedurally generated — archetype, personality, six-stat ability scores,
backstory, expression pack — and an **AI Game Master** uses those stats to
referee what you do: skill checks, persuasion, combat. Nothing is pre-scripted.

The difference from a chat frontend is **consequence**. When you tell the GM
you want to bluff the guard, it doesn't improvise agreeably — it picks the
check, rolls it against a real Wisdom score, and narrates the failure if you
lose. Two players who start in the same tavern end up in different worlds
because the dice actually decided something.

It's **game-first, not chat-first**: you launch into a spatial 2D world
rendered by PixiJS + bitECS, not a chatbot dashboard. The AI narrates;
deterministic rules decide.

| | |
| --- | --- |
| 🧠 **AI Game Master** | Describe what you want in plain language; the GM picks the check, calls the roll, and decides how the world reacts |
| 📜 **Stats that matter** | STR/DEX/CON/INT/WIS/CHA, skills, and HP aren't cosmetic — a high-Wisdom guard *will* see through your bluff |
| 🎨 **Procedural LPC sprites** | Characters assemble from modular Liberated Pixel Cup layers, so the visual baseline needs no AI at all |
| 💾 **Offline-first** | Campaigns, saves, and chat history live in a local Turso (libSQL) database; the game boots and plays with zero network |
| 🔑 **Vendor-agnostic AI** | Run local models in Docker, bring your own cloud key, or (later) use managed hosting |
| 🖥️ **Cross-platform** | PWA in the browser, native desktop via Tauri v2 (Windows/macOS/Linux) |

---

## Project status

**Early and moving fast.** Expect rough edges, missing pieces, and breaking
changes between commits — that's the deal with building in the open. The
engine, sprite pipeline, and AI gateway are the most solid parts; long-horizon
memory and persistent world state are still being built. See the
[roadmap](#roadmap).

---

## Play it

### In the browser — nothing to install

Open the [hosted client](https://aikami.bearlysleeping.com), drop an Anthropic
/ OpenAI / Gemini key (or any OpenAI-compatible endpoint) into Settings, and
play. Your saves stay in your browser.

### Desktop app

Grab a build from [Releases](https://github.com/BearlySleeping/aikami/releases),
or build from source:

```bash
bun install && bun tauri build
```

> **Linux AppImage won't launch?** Install `libfuse2`
> (`sudo apt install libfuse2` / `sudo dnf install fuse-libs`) — some newer
> distros drop it by default.

### Fully local, no API keys — Docker

A wizard detects your hardware, picks sane engine defaults, and writes `.env`;
then one `docker compose up -d` starts everything, including a browser client
at **http://localhost:5274**.

```bash
git clone https://github.com/BearlySleeping/aikami
cd aikami/apps/backend/local-stack

bun run init            # detects GPU/CPU/RAM, writes .env, shows the download plan
docker compose up -d    # pulls images, fetches models, starts the stack
```

Using the desktop app instead? Skip the browser client and enable just the
engines: `bun run stack init --yes --modalities text,image,voice`.

> The **[Local Stack README](apps/backend/local-stack/README.md)** is the
> source of truth for anything Docker or engine related — hardware backend
> matrix, swapping in Ollama/ComfyUI, STT, model licensing, the
> no-clone-needed install, and smoke tests.

---

## Develop it

**You need Bun. That's the whole hard requirement.**

```bash
git clone https://github.com/BearlySleeping/aikami && cd aikami
bun install
bun run setup:env   # writes local .env files — no cloud account needed
bun run dev         # client dev server → http://localhost:5173
```

`bun run setup` is an optional guided check of your machine (Bun, git, JDK,
Chromium, Tauri deps) that prints copy-paste install commands for anything
missing.

**Docker is not required to contribute.** It's only for running the local AI
engines in `apps/backend/local-stack/` — point the client at any cloud key
instead and everything else works.

### Tooling tiers — pick your depth

| Tier | What you add | What it buys you |
| --- | --- | --- |
| **0 — required** | Bun | Everything builds, tests, lints, and runs. This is enough to ship a PR. |
| **1 — recommended** | Nix + direnv | `direnv allow` and the whole toolchain (JDK, Chromium, Playwright, Tauri deps, Postgres) appears, pinned. No per-tool installs. |
| **2 — optional** | [pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) + [herdr](https://github.com/ogulcancelik/herdr) | How the maintainer works day to day: the contract pipeline, multi-pane dev sessions, autofix. |

The repo is opinionated about tier 2 because that's how it gets built — but
**nothing in the build, test, or review process requires it.** You will never
be asked to install pi or herdr to get a PR merged.

### Daily commands

```bash
bun run dev          # client dev server
bun run test         # all tests
bun run typecheck    # typecheck every project
bun run fix          # auto-fix lint + format (Biome)
bun moon run :validate   # the full gate CI runs
```

**Read [CONTRIBUTING.md](CONTRIBUTING.md) before your first PR** — it covers
the conventions, what those `C-xxx` comments mean, and how to pick a first
issue.

Deeper: [Setup Guide](docs/intro/setup.md) ·
[Developer Workflow](docs/guides/dev-workflow.md)

---

## How the AI works

Text, image, and voice generation all flow through one abstraction —
`AiProviderGateway` — so product code never knows which mode is active:

| Mode | What it means |
| --- | --- |
| **Local** | llama.cpp (text) · sd-server (image) · sherpa-onnx/Kokoro (voice), as Docker microservices on your hardware. Ollama and ComfyUI are opt-in swaps. |
| **BYOK** | Your own key for Anthropic, OpenAI, Gemini, ElevenLabs, Stability AI, or any OpenAI-compatible endpoint. |
| **Service** *(planned)* | Managed pay-as-you-go hosting — no GPU, no Docker, no setup. |

A text engine is required to play; image and voice are optional flourishes.
Accounts and cloud sync are **never** a boot dependency — your world plays and
saves fine without ever signing in.

---

## Architecture

The game engine runs behind a strict **Engine Boundary**: the 60fps PixiJS +
bitECS render loop is fully decoupled from Svelte's reactivity through a typed
`EngineBridge` message channel (`GameCommand` →, `GameEvent` ←). The UI layer
never touches per-frame data, and the engine never touches `$state`. That's
what lets a real-time game and a reactive UI framework coexist without melting
the main thread.

```
apps/
├── frontend/
│   ├── client/       # Main PWA + Tauri desktop app (SvelteKit 2, Svelte 5)
│   ├── hub/          # Community hub — assets, maps, mods, personas (Workers SSR)
│   ├── site/         # Public landing page (Astro)
│   └── docs/         # Documentation site (Astro)
└── backend/
    ├── local-stack/  # Publishable Docker topology — text/image/voice/stt + client
    ├── text/         # llama.cpp text engine
    ├── image/        # sd-server image engine
    ├── voice/        # sherpa-onnx/Kokoro voice + STT engine
    └── worker/       # Background jobs + Discord bot

packages/
├── shared/     # types, schemas, constants, parser, logger, utils, mocks
├── backend/    # auth, chat, database, svelte-kit, utils
└── frontend/   # engine (PixiJS+bitECS), ai-gateway, storage, services, components
```

The engine itself lives in `packages/frontend/engine`, fully extracted from
the client and reachable only through `EngineBridge`.

Deeper: [Architecture](docs/architecture/architecture.md) ·
[Project Structure](docs/guides/STRUCTURE.md)

---

## Tech stack

| Layer | Technology |
| --- | --- |
| Runtime / language | [Bun](https://bun.sh) · TypeScript (strict) |
| Monorepo | [Moon](https://moonrepo.dev) · Biome |
| Frontend | SvelteKit 2 + Svelte 5 Runes · Tauri v2 |
| Game | PixiJS v8 (WebGPU) + bitECS |
| Local persistence | Turso (libSQL) — offline-first source of truth |
| Cloud (optional) | Cloudflare Workers · D1 · R2 · Better Auth |
| AI | `AiProviderGateway` — local / BYOK / service |
| Validation | TypeBox |
| Testing | Playwright · `bun test` · Blackbox runner |

Full reference: [Tech Stack](docs/guides/STACK.md)

---

## Documentation

| Resource | What it covers |
| --- | --- |
| [Contributing](CONTRIBUTING.md) | **Start here** — first PR, conventions, contract IDs |
| [Setup Guide](docs/intro/setup.md) | Prerequisites, first-time setup, environment config |
| [Developer Workflow](docs/guides/dev-workflow.md) | Daily commands, testing, dev services |
| [Architecture](docs/architecture/architecture.md) | System architecture and the engine boundary |
| [Coding Standards](docs/guides/CODING_STANDARDS.md) | Conventions, including AI-agent coding rules |
| [Local Stack](apps/backend/local-stack/README.md) | Docker engines, hardware backends, models |
| [Database](docs/guides/database.md) | Server data plane, D1, migrations |
| [Feature Specs](docs/guides/FEATURES.md) | Personas, memory, lorebooks, world state |
| [Client Roadmap](docs/guides/CLIENT_FEATURES.md) | Full DND/JRPG feature roadmap |

AI coding agents: start at `.context/llms.txt`, then `.context/CONTEXT.md`.

---

## Roadmap

- **Now** — core loop: spatial world, procedural NPCs, dice and skill checks, character cards, persistence
- **Next** — DND depth: lorebooks, user personas, group chats, world generation
- **Later** — living world: relationships and factions, chat summarization, cross-session memory
- **Future** — branching stories, knowledge-graph visualization, voice cloning, managed hosting

Open requests: [`feature` label](https://github.com/BearlySleeping/aikami/issues?q=is%3Aissue+state%3Aopen+label%3Afeature)

---

## Contributing

Contributions, ideas, and bug reports are genuinely welcome — a one-line fix
or a proposal for something completely new. The project is early enough that
direction is still up for discussion.

- 🐛 **Bug?** [Open an issue](https://github.com/BearlySleeping/aikami/issues/new/choose)
- 💡 **Idea?** Open an issue or drop it in [Discord](https://discord.gg/XuuhWvSxHH)
- 🔧 **Code?** Read [CONTRIBUTING.md](CONTRIBUTING.md), then look for
  [`good first issue`](https://github.com/BearlySleeping/aikami/issues?q=is%3Aissue+state%3Aopen+label%3A%22good+first+issue%22)

---

## License

**Code** is [MIT](LICENSE) — free and open source, forever. Self-hosting will
always be an option; the planned managed tier is for people who'd rather not
run their own AI, and will never be required.

**Bundled art and audio** carry their own licenses (CC-BY-SA, CC-BY, GPL, OGA-BY
and others) — see **[LICENSE-ASSETS.md](LICENSE-ASSETS.md)** before
redistributing. Attribution manifests ship with the app and are visible in-game
under Credits.

<div align="center">

**BearlySleeping** — *Dreaming big, one line of code at a time.*

</div>
