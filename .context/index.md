# Aikami — AI Entry Point

> **For AI tools (pi, Claude, Gemini).** Start here, then follow the references.

## Read These First

1. **`.context/CONTEXT.md`** — 2-page AI briefing: what we're building, tech stack, active contracts
2. **`.context/llms.txt`** — Complete AI-first file index of all documentation
3. **`docs/contracts/INDEX.md`** — Active feature contracts with priorities

## Project at a Glance

Aikami is a monorepo application platform bridging web and desktop paradigms. 

**Tech stack**: Bun × SvelteKit 2 (SPA/PWA) × PixiJS v8 (Game) × bitECS × Firebase Data Connect × Tauri v2 × Docker (Local AI Microservices) × Moon × Biome

## Key Docs by Topic

| If you need... | Read... |
|----------------|---------|
| Architecture overview | `docs/architecture/architecture.md` |
| Engine boundary rules | `docs/architecture/limitations.md` |
| Coding standards | `docs/guides/CODING_STANDARDS.md` |
| Tech stack details | `docs/guides/STACK.md` |
| Project structure | `docs/guides/STRUCTURE.md` |
| Developer setup | `docs/intro/setup.md` |
| Product vision | `docs/intro/vision.md` |
| Contract template | `docs/contracts/TEMPLATE.md` |
| CI/CD pipeline | `docs/guides/CI_CD.md` |
| Testing strategy | `docs/guides/TESTING.md` |

## How AI Tools Work With This Repo

```
pi ──reads──→ .context/llms.txt ──→ finds relevant specs
pi ──reads──→ .context/CONTEXT.md ──→ understands project
pi ──reads──→ docs/contracts/*.md ──→ implements features
pi ──writes─→ code changes ──→ Git
pi ──updates→ .context/llms.txt + .context/CONTEXT.md after changes
```

**Key rule:** The repo IS the source of truth. `.context/llms.txt` is the AI-first map.
