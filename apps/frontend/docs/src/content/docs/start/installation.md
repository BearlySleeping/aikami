---
title: Installation
description: Four ways to run Aikami — hosted web client, native desktop app, Docker, or from source.
sidebar:
  order: 1
---

Pick whichever fits how you want to run it. All four play the same game; they
differ in how much setup they need and where the AI runs.

## Option 1 — Web, bring your own key

No install at all. Open the [hosted client](https://aikami.bearlysleeping.com),
drop your Anthropic / OpenAI / Gemini key (or any OpenAI-compatible endpoint)
into Settings, and play.

This is the fastest way to try Aikami. Your key stays in your browser and
requests go straight to the provider — see
[Choosing your AI setup](/start/ai-setup/) for what that costs.

## Option 2 — Desktop app

Native, Rust-powered, small bundle. Grab a prebuilt release from
[GitHub Releases](https://github.com/BearlySleeping/aikami/releases), or build
from source:

```bash
bun install
bun tauri build
```

Works with a local Ollama/vLLM instance or your own cloud keys. Available for
Windows (`.exe`), macOS (universal `.dmg`), and Linux (AppImage).

:::note[Linux: AppImage requirements]
The AppImage needs glibc 2.35+ and `libfuse2` to mount. Newer distros
(Ubuntu 22.04+, Fedora 36+, Debian 12) ship libfuse3 and need libfuse2
installed separately:

```bash
# Debian/Ubuntu
sudo apt install libfuse2

# Fedora
sudo dnf install fuse-libs
```
:::

## Option 3 — Docker (fully local, zero cloud)

Everything runs on your own hardware. After the first pull — and the
client's one-time asset download, see below — no internet is required. The
default engines are llama.cpp (text), sd-server (image), and
sherpa-onnx/Kokoro (voice); Ollama and ComfyUI are supported as opt-in
drop-in swaps.

```bash
git clone https://github.com/BearlySleeping/aikami
cd aikami/apps/backend/local-stack

bun run stack init      # detects your GPU/CPU/RAM, writes .env
docker compose up -d    # pulls images, fetches models, starts the stack
```

Open **http://localhost:5274** and you're playing.

The full stack works on CPU (that's the default `stack init` falls back to
with no GPU tooling detected), but a GPU makes text and image generation
meaningfully faster — see the backend matrix below. If you're bringing your
own endpoints / API keys instead, run just the client:

```bash
echo "COMPOSE_PROFILES=client" >> .env
docker compose up -d
```

**Want Ollama or ComfyUI instead of the built-in engines?** Both are
supported drop-in swaps on the same ports:

```bash
# .env
COMPOSE_PROFILES=text,ollama      # Ollama replaces llama.cpp on :11434
COMPOSE_PROFILES=image,comfyui    # ComfyUI replaces sd-server on :8188
```

**Picking a hardware backend explicitly** (CPU/CUDA/ROCm/Vulkan/Intel/MUSA),
enabling speech-to-text, the macOS native path (Docker Desktop has no Metal
passthrough), model licensing, and smoke tests to verify everything's
healthy — all covered in the
[Local Stack README](https://github.com/BearlySleeping/aikami/blob/main/apps/backend/local-stack/README.md),
the source of truth for the Docker setup.

Don't even want to clone the repo? You don't have to — the engine images
pull from GHCR by default, so a standalone `compose*.yaml` + `.env` (no
checkout) works too; you only lose the hardware-detection wizard. See "No
repo checkout required" in the Local Stack README.

## Option 4 — From source

For contributors, or anyone who wants to modify the engine.

```bash
git clone https://github.com/BearlySleeping/aikami
cd aikami

bun run setup       # local machine setup (checks bun, jdk, chromium, ...)
bun run setup:env   # fetch .env.emulator secrets
bun run dev         # client dev server
bun run dev:all     # client + local Cloudflare dev plane (D1 + R2 via wrangler)
```

Aikami is a Bun + [Moon](https://moonrepo.dev) monorepo. See
[Coding Standards](https://github.com/BearlySleeping/aikami/blob/main/docs/guides/CODING_STANDARDS.md)
before opening a PR.

## What gets stored where

However you install it, campaigns, saves, and chat history live in a local
Turso (libSQL) database on your machine — that's the source of truth, not a
server-side copy. Cloudflare D1 holds account identity and community pack
metadata, and Cloudflare R2 holds the published asset catalog and optional save
backups. Signing in is never a boot dependency: the game plays and saves fine
without an account.

## First run downloads the art

Aikami ships **without** its sprite, map, and audio library — that's why the
desktop bundle is small. The first time you launch it, the client downloads the
starter content it needs from the asset catalog, verifies each file's SHA-256,
and pins it in a local cache (the Tauri native disk cache on desktop, OPFS in
the browser).

You'll see a download stage in the boot progress while this happens. After that
first run the game plays **completely offline** — no catalog fetch, no account,
no network of any kind.

If you launch for the very first time with no connection, Aikami tells you it
needs to download starter content rather than hanging or showing an empty
world. Connect once, and you're set.

:::tip[Planning an offline session?]
Launch the app once while you still have a connection. Everything after that
first successful launch works on a plane, in a basement, or behind an
air-gapped firewall — see [Asset Management](/features/asset-management/) for
how the cache works.
:::

## Starting a campaign

Press **New Game** and you go straight to the world — no AI world-generation
wait. When more than one adventure is installed you first pick one from the
adventure list (each pack ships its own map and quests); with a single
adventure installed the picker is skipped.

Where you land after that depends on how many heroes you already have: with
no heroes saved you're routed through onboarding to create your first hero;
with exactly one hero you jump straight into the world as that hero; with
two or more heroes you pick which one to play.

A separate **Advanced → World Generation (Preview)** entry on the start screen
lets you prototype AI-generated settings. It produces a world preview for
story inspiration — it is **not playable yet** (the generated map compiler,
[issue #81](https://github.com/BearlySleeping/aikami/issues/81), is still in
progress); the playable world always comes from the authored adventure pack
you selected.
