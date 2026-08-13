<div align="center">

# 🗡️ Aikami

### The self-hosted AI RPG engine where every NPC thinks, remembers, and adapts.

Open-source · Offline-first · BYOK · No subscription required

[![License: MIT](https://img.shields.io/github/license/BearlySleeping/aikami?color=6d28d9)](https://github.com/BearlySleeping/aikami/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/BearlySleeping/aikami?style=social)](https://github.com/BearlySleeping/aikami/stargazers)
[![Open issues](https://img.shields.io/github/issues/BearlySleeping/aikami)](https://github.com/BearlySleeping/aikami/issues)
[![Status](https://img.shields.io/badge/status-early%20development-orange)](#-project-status)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](#-contributing)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/XuuhWvSxHH)
[![Built with Bun](https://img.shields.io/badge/runtime-Bun-fbf0df?logo=bun&logoColor=black)](https://bun.sh)
[![SvelteKit](https://img.shields.io/badge/frontend-SvelteKit%205-ff3e00?logo=svelte&logoColor=white)](https://svelte.dev)

**[🎮 Launch the Web Client](https://aikami.bearlysleeping.com)** · **[🌐 Landing Page](https://bearlysleeping.com)** · **[💬 Discord](https://discord.gg/XuuhWvSxHH)** · **[🐛 Report a Bug](https://github.com/BearlySleeping/aikami/issues)** · **[💡 Request a Feature](https://github.com/BearlySleeping/aikami/issues?q=is%3Aissue+state%3Aopen+label%3Afeature)**

</div>

---

## ✨ What is Aikami?

Aikami is an **open-source AI RPG engine** that fuses tabletop-style D&D mechanics with LLM-driven roleplay. Every NPC is procedurally generated — archetype, personality, full six-stat ability scores, backstory, and a dynamic expression pack — and an **AI Game Master** uses those stats to referee everything you do: skill checks, persuasion attempts, combat, the works. Nothing is pre-scripted. Two players who start in the same tavern can end up in completely different worlds.

It's built **game-first, not chat-first**: you launch into a spatial 2D world rendered by PixiJS + bitECS, not a chatbot dashboard. The AI narrates; deterministic rules decide.

- 🧠 **AI Game Master** — describe the action you want to take in plain language; the GM decides what check to roll, when a fight starts, and how the world reacts
- 📜 **D&D-flavored NPCs** — STR/DEX/CON/INT/WIS/CHA, skills, and HP aren't cosmetic, they drive every interaction (a high-Wisdom guard _will_ see through your bluff)
- 🧵 **Persistent memory & world state** — NPCs remember what you did, relationships and factions evolve across sessions, nothing resets when you close the tab
- 🎨 **Procedural LPC sprites** — every character is assembled from modular Liberated Pixel Cup layers, no static sprite sheets, zero AI dependency for the visual baseline
- 💾 **Offline-first** — campaigns, saves, and chat history live in a local Turso (libSQL) database; the game boots and plays with zero network
- 🔑 **Vendor-agnostic AI** — run local models (Ollama / ComfyUI / Kokoro via Docker), bring your own cloud API key, or (soon) use Aikami's managed hosting
- 🖥️ **Cross-platform** — Progressive Web App, native desktop via Tauri v2 (Windows/macOS/Linux), and a SvelteKit community hub for sharing assets, maps, and mods

---

## 🚧 Project Status

Aikami is **early and moving fast**. Expect rough edges, missing pieces, and breaking changes between commits — that's the deal with building in the open. If you hit a bug, have an idea, or just want to poke around the code, you're exactly who this project is for. See [Contributing](#-contributing) below.

---

## 🚀 Getting Started

Pick whichever fits how you want to run it:

### Option 1 — Docker (zero setup, fully local)

```bash
git clone https://github.com/BearlySleeping/aikami
cd aikami

# Everything local: client + ComfyUI (image) + Kokoro (voice) + Ollama (text)
docker compose up aikami

# ...or just the client, if you're bringing your own endpoints / API keys
docker compose up aikami-client
```

Open **http://localhost:5173** and you're playing. No internet required after the first pull.

### Option 2 — From source (Bun + Moon)

```bash
git clone https://github.com/BearlySleeping/aikami
cd aikami

bun run setup       # local machine setup (checks bun, jdk, chromium, ...)
bun run setup:env   # generate .env.emulator files (no GCP access needed)
bun run dev         # client dev server
bun run dev:all     # client + Firebase emulators (herdr workspace)
```

### Local PostgreSQL (dev)

Aikami pins **PostgreSQL 17** in the Nix devShell — the same engine major the
production providers speak over the wire — and runs it as a herdr dev service
like any other. No Docker, no system Postgres, no sudo: the server runs as
your OS user, binds to `127.0.0.1:5433` only (port 5432 is left free for your
own system Postgres), and keeps all state in the gitignored `.postgres/`
directory.

```bash
bun herdr:start postgres   # or: bun postgres:start (background)
bun herdr:stop postgres    # or: bun postgres:stop
bun postgres:status        # server state + connection details
bun postgres:reset --yes   # delete all local data and re-initialise
bun postgres:psql          # interactive psql
```

Connection URL (database `aikami_dev` is created for you by `init`):

```
postgresql://localhost:5433/aikami_dev?sslmode=disable
```

Lifecycle script: `scripts/src/lib/postgres/lifecycle.ts`. If a previous run
left a stale `postmaster.pid`, `start` clears it automatically.

### Option 3 — Desktop app (Tauri v2)

```bash
# Grab a prebuilt release
# https://github.com/BearlySleeping/aikami/releases

# ...or build from source
bun install
bun tauri build
```

Native, Rust-powered, sub-5MB bundle. Works with local Ollama/vLLM or your own cloud keys.

Linux ships as an AppImage (runs on any distro, no install needed). If it won't launch, install `libfuse2` — some newer distros (Ubuntu 22.04+, Fedora 36+, Debian 12) don't include it by default:

```bash
# Debian/Ubuntu
sudo apt install libfuse2

# Fedora
sudo dnf install fuse-libs
```

### Option 4 — Web, bring your own key

No install at all: open the [hosted client](https://aikami.bearlysleeping.com), drop your Anthropic / OpenAI / Gemini (or any OpenAI-compatible endpoint) key into Settings, and play. Mix and match TTS and image providers per NPC if you want.

More detail: [Setup Guide](docs/intro/setup.md) · [Developer Workflow](docs/guides/dev-workflow.md)

---

## 🤖 How the AI actually works

All text, image, and voice generation flows through one abstraction — `AiProviderGateway` — so product code never cares which mode is active:

| Mode                        | What it means                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Offline / local**         | Ollama (text), ComfyUI (image), Kokoro (voice) — run as Docker microservices on your own hardware             |
| **BYOK**                    | Bring your own key for Anthropic, OpenAI, Gemini, ElevenLabs, Stability AI, or any OpenAI-compatible endpoint |
| **Service** _(coming soon)_ | Fully managed, pay-as-you-go hosting on Aikami's infrastructure — no GPU, no Docker, no setup                 |

A text engine is always required to actually play — that's the core of the game. Image and voice generation are optional flourishes; the LPC sprite system covers the visual baseline with zero AI dependency either way.

Everything is **local-first by design**: Firebase (auth + optional cloud sync/backup) is layered on top and is never a boot dependency. Your world plays and saves fine without ever signing in.

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                       Aikami Platform                             │
├──────────────┬──────────────────────┬──────────────┬─────────────┤
│ Client+Tauri │   Game Engine        │  Hub (SSR)   │ Site/Docs   │
│ (SvelteKit 2)│ (PixiJS v8+bitECS)   │ (Cloud Run)  │ (Astro)     │
├──────────────┴──────────┬───────────┴──────────────┴─────────────┤
│    Turso (libSQL) — local source of truth                        │
├─────────────────────────┴────────────────────────────────────────┤
│      Firebase — auth, optional sync, infrastructure only         │
│         Functions │ Auth │ Storage │ Firestore (infra)           │
├──────────────────────────────────────────────────────────────────┤
│        Local AI Microservices (Docker/herdr)                     │
│   ComfyUI (image) │ Ollama (text) │ Kokoro (voice)               │
├──────────────────────────────────────────────────────────────────┤
│               Shared Packages (packages/shared/)                  │
│  constants │ types │ schemas │ parser │ logger │ utils │ mocks   │
├──────────────────────────────────────────────────────────────────┤
│              Backend Packages (packages/backend/)                 │
│  auth │ chat │ configs │ database │ svelte-kit │ utils           │
├──────────────────────────────────────────────────────────────────┤
│             Frontend Packages (packages/frontend/)                │
│  configs │ engine │ ai-gateway │ repositories │ services │ utils │
└──────────────────────────────────────────────────────────────────┘
```

The game engine runs behind a strict **Engine Boundary**: the 60fps PixiJS + bitECS render loop is fully decoupled from Svelte's reactivity via a typed `EngineBridge` message channel (`GameCommand` →, `GameEvent` ←). The UI layer never touches per-frame data, and the engine never touches `$state` — which is what lets a real-time game and a reactive UI framework coexist without melting the main thread.

Full write-up: [Architecture](docs/architecture/architecture.md)

---

## 🧰 Tech Stack

| Layer                 | Technology                                                   |
| --------------------- | ------------------------------------------------------------ |
| Runtime               | [Bun](https://bun.sh)                                        |
| Language              | TypeScript, strict mode                                      |
| Monorepo              | [Moon](https://moonrepo.dev)                                 |
| Frontend              | SvelteKit 2 + Svelte 5 Runes                                 |
| Desktop               | Tauri v2                                                     |
| Game rendering        | PixiJS v8 (WebGPU)                                           |
| Game logic            | bitECS (data-oriented ECS)                                   |
| Local persistence     | Turso (libSQL) — offline-first source of truth               |
| Cloud sync (optional) | Firebase (Auth, Storage, Functions)                          |
| Local AI              | Ollama (text) · ComfyUI (image) · Kokoro (voice), via Docker |
| AI abstraction        | `AiProviderGateway` — offline / BYOK / service               |
| Validation            | TypeBox                                                      |
| Community hub         | SvelteKit SSR on Google Cloud Run (Bun adapter)              |
| Static sites          | Astro (landing page, docs)                                   |
| Linting/formatting    | Biome                                                        |
| Testing               | Playwright · Vitest · Blackbox runner                        |

Full reference: [Tech Stack](docs/guides/STACK.md)

---

## 📁 Project Structure

```
apps/
├── frontend/
│   ├── client/     # Main PWA + Tauri desktop app (SvelteKit 2, Svelte 5)
│   ├── hub/         # Community hub — assets, maps, mods, personas (Cloud Run)
│   ├── site/        # Public landing page (Astro)
│   └── docs/         # Documentation site (Astro)
└── backend/
    ├── firebase/    # Cloud Functions, auth triggers, security rules
    ├── image/        # ComfyUI Docker microservice
    ├── text/         # Ollama Docker microservice
    └── voice/        # Kokoro Docker microservice

packages/
├── shared/     # types, schemas, constants, parser, logger, utils, mocks
├── backend/    # auth, chat, database, svelte-kit, utils
└── frontend/   # engine (PixiJS+bitECS), ai-gateway, repositories, services, components
```

The game engine itself lives in `packages/frontend/engine`, fully extracted from the client and reachable only through `EngineBridge`.

Full reference: [Project Structure](docs/guides/STRUCTURE.md)

---

## 📚 Documentation

| Resource                                                 | What it covers                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------- |
| [Setup Guide](docs/intro/setup.md)                       | Prerequisites, first-time setup, environment config                 |
| [Developer Workflow](docs/guides/dev-workflow.md)        | Daily commands, testing, emulator usage                             |
| [Architecture](docs/architecture/architecture.md)        | System architecture and the engine boundary                         |
| [Project Structure](docs/guides/STRUCTURE.md)            | Monorepo layout and where things live                               |
| [Tech Stack](docs/guides/STACK.md)                       | Technologies, frameworks, and services                              |
| [Coding Standards](docs/guides/CODING_STANDARDS.md)      | Conventions, including AI-agent coding rules                        |
| [Feature Specs](docs/guides/FEATURES.md)                 | Deep-dive specs: personas, memory, lorebooks, world state, and more |
| [Client Feature Roadmap](docs/guides/CLIENT_FEATURES.md) | Full DND/JRPG feature roadmap and priority order                    |

For AI coding agents: start at `.context/llms.txt`, then `.context/CONTEXT.md`.

---

## 🗺️ Roadmap

Rough shape of where things are headed — see [Feature Specs](docs/guides/FEATURES.md) and [Client Feature Roadmap](docs/guides/CLIENT_FEATURES.md) for the full detail:

- **Now — Core loop:** chat interface, character cards, dice rolling, single AI backend, chat persistence
- **Next — DND depth:** character stats, world info/lorebooks, user personas, group chats
- **Later — Living world:** character relationships, chat summarization, AI-generated lorebooks, persistent world state, cross-chat memory
- **Future — Premium & scale:** branching stories, knowledge graph visualization, voice cloning, managed pay-as-you-go hosting (no BYOK / no self-hosting required)

Open feature requests: [GitHub Issues → `feature` label](https://github.com/BearlySleeping/aikami/issues?q=is%3Aissue+state%3Aopen+label%3Afeature)

---

## 🤝 Contributing

Aikami is free, open-source, and very much still being built — **contributions, new ideas, and bug reports are all genuinely welcome**, whether that's a one-line fix or a proposal for something completely new.

- 🐛 **Found a bug?** [Open an issue](https://github.com/BearlySleeping/aikami/issues)
- 💡 **Have an idea?** Open an issue or drop it in [Discord](https://discord.gg/XuuhWvSxHH)
- 🔧 **Want to write code?** Fork the repo, check [Coding Standards](docs/guides/CODING_STANDARDS.md), and open a PR
- 🗣️ **Just want to chat about the project?** [Join the Discord](https://discord.gg/XuuhWvSxHH) — it's the fastest way to reach the team

No contribution is too small, and no idea is too weird — this is early enough that direction is still very much up for discussion.

---

## 📜 License

Aikami is [MIT licensed](https://github.com/BearlySleeping/aikami/blob/main/LICENSE) — free and open source, forever. Self-hosting will always be an option; a managed pay-as-you-go tier is planned for people who'd rather not run their own AI, but it will never be required.

---

<div align="center">

**BearlySleeping** — _Dreaming big, one line of code at a time._

[Website](https://bearlysleeping.com) · [Web Client](https://aikami.bearlysleeping.com) · [Discord](https://discord.gg/XuuhWvSxHH) · [GitHub](https://github.com/BearlySleeping/aikami)

</div>
