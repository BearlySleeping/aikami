# Welcome to Aikami Docs

> The unified single source of truth for Aikami architecture, conventions, and developer coordination.

## What is Aikami?

Aikami is a modern monorepo application platform with a web-native game engine. It provides a Progressive Web App (Client) with real-time features, a PixiJS v8 + bitECS 2D game engine, desktop export via Tauri v2, offline-first persistence via Turso (libSQL), local AI microservices, and a SvelteKit SSR Hub running on Cloudflare Workers.

- **SvelteKit Client + Tauri v2** — Cross-platform progressive web app exported as native desktop app
- **PixiJS v8 + bitECS Game Engine** — WebGPU-accelerated 2D rendering with data-oriented ECS architecture
- **Turso (libSQL) Offline-First** — Local-first persistence: campaigns, saves, and chat history live in an embedded SQLite-compatible store (C-321); cloud sync is an optional adapter, never a boot dependency
- **SvelteKit Hub (SSR)** — Community hub on Cloudflare Workers (D1 + R2, Better Auth) for community assets, maps, mods, and managing your own characters/personas
- **Local AI Microservices** — llama.cpp (text), sd-server (image), sherpa-onnx/Kokoro (voice) via Docker/herdr (C-390); Ollama/ComfyUI as opt-in swaps
- **Bun Runtime** — Fast JavaScript/TypeScript runtime
- **Moon Monorepo** — Task orchestration and dependency management
- **Biome** — Consistent linting and formatting
- **Vendor-Agnostic AI** — AiProviderGateway abstraction with offline / BYOK / service modes

## Quick Start

1. Read `intro/README.md` — Project overview
2. Read `intro/vision.md` — Product vision
3. Read `intro/setup.md` — Developer setup guide
4. Read `architecture/architecture.md` — System architecture (updated stack, engine boundary)
5. Read `guides/CODING_STANDARDS.md` — Includes strict AI coding rules
6. Read `architecture/limitations.md` — Engine boundary constraints and known gaps
7. Check `contracts/INDEX.md` — Active work items
8. Read `strategy/mvp-assessment-2026-08-16.md` — Current MVP state, defect
   inventory, and infrastructure/go-to-market assessment; its backlog is
   `contracts/MVP_BACKLOG.md`

## For AI Tools

1. Read `.context/llms.txt` first — AI-first file index
2. Read `.context/CONTEXT.md` — 2-page project briefing
3. Find relevant files, read them, then write
