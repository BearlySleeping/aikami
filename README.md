<div align="center">

# 🗡️ Aikami

### The self-hosted AI RPG engine where every NPC thinks, remembers, and adapts.

Open source · Offline-first · Bring your own key · No subscription

[![License: MIT](https://img.shields.io/github/license/BearlySleeping/aikami?color=6d28d9)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/BearlySleeping/aikami?style=social)](https://github.com/BearlySleeping/aikami/stargazers)
[![Status](https://img.shields.io/badge/status-early%20development-orange)](#project-status)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/XuuhWvSxHH)

**[🎮 Play](https://aikami.bearlysleeping.com)** · **[💬 Discord](https://discord.gg/XuuhWvSxHH)** · **[🐛 Issues](https://github.com/BearlySleeping/aikami/issues)**

</div>

---

## What is Aikami?

Aikami fuses tabletop D&D mechanics with LLM-driven roleplay. NPCs are
procedurally generated — archetype, personality, six-stat ability scores,
backstory, expression pack — and an **AI Game Master** uses those stats to
referee what you do: skill checks, persuasion, combat. Nothing is pre-scripted.
Two players who start in the same tavern end up in different worlds.

It's **game-first, not chat-first**: you launch into a spatial 2D world
rendered by PixiJS + bitECS, not a chatbot dashboard. The AI narrates;
deterministic rules decide.

- 🧠 **AI Game Master** — describe what you want to do in plain language; the GM picks the check, calls the roll, and decides how the world reacts
- 📜 **Stats that matter** — STR/DEX/CON/INT/WIS/CHA, skills, and HP aren't cosmetic; a high-Wisdom guard *will* see through your bluff
- 🎨 **Procedural LPC sprites** — characters are assembled from modular Liberated Pixel Cup layers, so the visual baseline needs no AI at all
- 💾 **Offline-first** — campaigns, saves, and chat history live in a local Turso (libSQL) database; the game boots and plays with zero network
- 🔑 **Vendor-agnostic AI** — run local models in Docker, bring your own cloud key, or (later) use managed hosting
- 🖥️ **Cross-platform** — PWA in the browser, native desktop via Tauri v2 (Windows/macOS/Linux)

---

## Project status

**Early and moving fast.** Expect rough edges, missing pieces, and breaking
changes between commits — that's the deal with building in the open. The
engine, sprite pipeline, and AI gateway are the most solid parts; long-horizon
memory and persistent world state are still being built. See the
[roadmap](#roadmap).

---

## Run it

### Play in the browser

Nothing to install. Open the [hosted client](https://aikami.bearlysleeping.com),
drop an Anthropic / OpenAI / Gemini key (or any OpenAI-compatible endpoint)
into Settings, and play.

### Desktop app

```bash
# Prebuilt: https://github.com/BearlySleeping/aikami/releases
bun install && bun tauri build   # or build from source
```

Linux ships as an AppImage. If it won't launch, install `libfuse2`
(`sudo apt install libfuse2` / `sudo dnf install fuse-libs`) — some newer
distros drop it by default.

### Fully local, no API keys (Docker)

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

### Build from source

```bash
git clone https://github.com/BearlySleeping/aikami && cd aikami
bun run setup       # checks bun, jdk, chromium, ...
bun run setup:env   # generate .env.emulator files (no GCP access needed)
bun run dev         # client dev server
```

Full contributor setup: [Setup Guide](docs/intro/setup.md) ·
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
Firebase (auth and optional cloud sync) sits on top and is **never** a boot
dependency — your world plays and saves fine without ever signing in.

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
│   ├── hub/          # Community hub — assets, maps, mods, personas (Cloud Run)
│   ├── site/         # Public landing page (Astro)
│   └── docs/         # Documentation site (Astro)
└── backend/
    ├── firebase/     # Cloud Functions, auth triggers, security rules
    ├── local-stack/  # Publishable Docker topology — text/image/voice/stt + client
    ├── text/         # llama.cpp text engine
    ├── image/        # sd-server image engine
    ├── voice/        # sherpa-onnx/Kokoro voice + STT engine
    └── worker/       # Background jobs

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
| Cloud (optional) | Firebase (Auth, Storage, Functions) · Cloud Run · Neon Postgres |
| AI | `AiProviderGateway` — local / BYOK / service |
| Validation | TypeBox |
| Testing | Playwright · Vitest · Blackbox runner |

Full reference: [Tech Stack](docs/guides/STACK.md)

---

## Documentation

| Resource | What it covers |
| --- | --- |
| [Setup Guide](docs/intro/setup.md) | Prerequisites, first-time setup, environment config |
| [Developer Workflow](docs/guides/dev-workflow.md) | Daily commands, testing, emulators |
| [Architecture](docs/architecture/architecture.md) | System architecture and the engine boundary |
| [Coding Standards](docs/guides/CODING_STANDARDS.md) | Conventions, including AI-agent coding rules |
| [Local Stack](apps/backend/local-stack/README.md) | Docker engines, hardware backends, models |
| [Database](docs/guides/database.md) | Local Postgres, Neon, migrations |
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

- 🐛 **Bug?** [Open an issue](https://github.com/BearlySleeping/aikami/issues)
- 💡 **Idea?** Open an issue or drop it in [Discord](https://discord.gg/XuuhWvSxHH)
- 🔧 **Code?** Fork it, skim [Coding Standards](docs/guides/CODING_STANDARDS.md), open a PR

---

## License

[MIT](LICENSE) — free and open source, forever. Self-hosting will always be an
option; the planned managed tier is for people who'd rather not run their own
AI, and will never be required.

<div align="center">

**BearlySleeping** — *Dreaming big, one line of code at a time.*

</div>
