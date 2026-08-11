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

Everything runs on your own hardware — no internet required after the first
pull.

```bash
git clone https://github.com/BearlySleeping/aikami
cd aikami

# Everything local: client + ComfyUI (image) + Kokoro (voice) + Ollama (text)
docker compose up aikami

# ...or just the client, if you're bringing your own endpoints / API keys
docker compose up aikami-client
```

Open **http://localhost:5173** and you're playing.

The full stack expects a GPU — text generation via Ollama is the demanding
part, image generation via ComfyUI more so. The `aikami-client` variant has no
such requirement since you supply the endpoints.

## Option 4 — From source

For contributors, or anyone who wants to modify the engine.

```bash
git clone https://github.com/BearlySleeping/aikami
cd aikami

bun run setup       # local machine setup (checks bun, jdk, chromium, ...)
bun run setup:env   # generate .env.emulator files (no GCP access needed)
bun run dev         # client dev server
bun run dev:all     # client + Firebase emulators
```

Aikami is a Bun + [Moon](https://moonrepo.dev) monorepo. See
[Coding Standards](https://github.com/BearlySleeping/aikami/blob/main/docs/guides/CODING_STANDARDS.md)
before opening a PR.

## What gets stored where

However you install it, campaigns, saves, and chat history live in a local
Turso (libSQL) database on your machine — that's the source of truth, not a
server-side copy. Firebase (auth and optional cloud sync) layers on top and is
never a boot dependency: the game plays and saves fine without ever signing in.
