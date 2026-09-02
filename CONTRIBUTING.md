# Contributing to Aikami

Thanks for being here. Aikami is early enough that direction is still up for
discussion — a one-line fix and a "have you considered doing this completely
differently" issue are both genuinely welcome.

This page is the short version. It should be everything you need for a first PR.

---

## TL;DR

```bash
git clone https://github.com/BearlySleeping/aikami && cd aikami
bun install
bun run setup:env    # local .env files, no cloud account needed
bun run dev          # → http://localhost:5173

# before you push
bun run fix          # auto-fix lint + format
bun moon run :validate
bun run test
```

**Bun is the only hard requirement.** No Docker, no cloud account, no
Cloudflare login, no agent tooling.

> **Hub dev:** `bun moon run hub:dev` runs Vite (fast HMR, no D1/R2 bindings).
> For auth, catalog, or save-backup work, use `bun moon run hub:dev-worker`
> which runs the real Workers runtime with local D1 and R2.
> See [docs/guides/dev-workflow.md](docs/guides/dev-workflow.md#local-cloudflare-runtime).

> **Build caching:** `bun run build` in an app directory (client, hub, site,
> docs, `apps/backend/cloudflare`) routes through `moon run <project>:build`,
> so it shares moon's hashing and remote cache with CI. If the cache is wrong
> and you need to bypass it, run the underlying command directly with
> `bun run build:app` in that app's directory.

---

## What you actually need

| Tier | Add | Buys you |
| --- | --- | --- |
| **0 — required** | Bun 1.3+ | Everything builds, tests, lints, runs. Enough to ship a PR. |
| **1 — recommended** | Nix + direnv | `direnv allow` and the toolchain (JDK, Chromium, Playwright, Tauri deps) appears, pinned. |
| **2 — optional** | pi + herdr | The maintainer's day-to-day loop: contract pipeline, multi-pane dev, autofix. |

`bun run setup` walks your machine and prints install commands for anything
missing. It checks tier-2 tools too — **those lines are informational.** You
will never be asked to install pi or herdr to get a PR merged.

**Docker is only for `apps/backend/local-stack/`** — the local AI engines. If
you're bringing your own API key, you never need it.

### Windows

Supported and regularly used. Install Git Bash and enable long paths:

```bash
git config --global core.longpaths true
```

`bun run setup` checks both and tells you if something's off. If you'd rather
use the Nix devShell, run it under WSL.

---

## Finding something to work on

- **[`good first issue`](https://github.com/BearlySleeping/aikami/issues?q=is%3Aissue+state%3Aopen+label%3A%22good+first+issue%22)** — scoped, reviewed, safe to grab. Comment on it and it's yours.
- **[`help wanted`](https://github.com/BearlySleeping/aikami/issues?q=is%3Aissue+state%3Aopen+label%3A%22help+wanted%22)** — bigger, still wanted.
- **Something else entirely** — open an issue first if it's more than an hour
  of work, so you don't build something that collides with in-flight work.

Small fixes (typos, an obvious bug, a missing null check) need no issue. Just
open the PR.

---

## Those `C-xxx` comments everywhere

You'll see this a lot:

```ts
// C-426 AC-1: the Cloudflare D1 schema (Drizzle `sqlite` dialect).
```

A **contract** is a written spec — problem statement, data models,
acceptance criteria — that a feature was built against. `C-426` is its ID, and
the file is right there in the repo:

```bash
ls docs/contracts/C-426*
# docs/contracts/C-426-cloudflare-native-identity-and-hosting.md
```

`AC-1` means "acceptance criterion 1" inside that contract. `docs/contracts/INDEX.md`
lists them all.

**Why this exists:** most of the codebase is built by AI agents running a
pipeline (`bun run contract`), and the contract is the spec they work from.
It's also the archaeology — you'll find contracts referencing Godot, Firebase,
and Cloud Run because the project genuinely passed through all three.

**What this means for you:**

- You do **not** need to write a contract to contribute. Contracts are for
  large maintainer-driven features.
- You do **not** need to reference a contract ID in your code comments.
- If a comment is just `// C-433: do X` and you can't tell why, the contract
  file is the answer — and improving that comment to explain the *reason* is a
  welcome change on its own.

Going forward the convention is: **the comment states the reason, the contract
ID trails as a citation** — not the other way around.

---

## Code conventions

Biome enforces most of this automatically (`bun run fix`). The rules that trip
people up:

| Rule | Do | Don't |
| --- | --- | --- |
| Types over interfaces | `type User = {...}` | `interface User {...}` |
| Arrow functions | `const fn = () => {}` | `function fn() {}` |
| Snake_case filenames | `user_service.ts` | `userService.ts` |
| Options object past 1 param | `fn({ email, name })` | `fn(email, name)` |
| Private members | `private readonly _db` | `private readonly db` |
| Import from package root | `from "@aikami/types"` | `from "@aikami/types/lib/user"` |

### Where things live

Types, schemas, and constants belong in `packages/shared/` — never in an app.

| What | Where | Import as |
| --- | --- | --- |
| Domain types | `packages/shared/types/src/lib/` | `@aikami/types` |
| TypeBox schemas | `packages/shared/schemas/src/lib/` | `@aikami/schemas` |
| Global constants | `packages/shared/constants/` | `@aikami/constants` |

**Never** import from one app into another, and never define a shared type
inside `apps/`.

### The client is a static SPA

`apps/frontend/client` ships inside Tauri. There is no server. These will fail
review:

- ❌ `+server.ts`, `+page.server.ts`, `+layout.server.ts`

Use client-side data loading, fetches to the microservices, browser APIs, or
Tauri commands instead.

### The Engine Boundary

The PixiJS + bitECS render loop in `packages/frontend/engine` is decoupled from
Svelte by a typed message channel. **UI code never touches per-frame engine
data; engine code never touches `$state`.** Everything crosses through
`EngineBridge` (`GameCommand` in, `GameEvent` out). If your change makes those
two talk directly, it'll be sent back.

### Deeper conventions

The full rules live in `.pi/skills/` and are readable as plain markdown — no
agent tooling required:

| Topic | File |
| --- | --- |
| Universal rules | `.pi/skills/aikami-conventions/SKILL.md` |
| Svelte / frontend | `.pi/skills/svelte-conventions/SKILL.md` |
| Backend layering | `.pi/skills/backend-conventions/SKILL.md` |
| UI / Tailwind + daisyUI | `.pi/skills/aikami-ui/SKILL.md` |
| Testing | `.pi/skills/testing/SKILL.md` |

Also: [Coding Standards](docs/guides/CODING_STANDARDS.md).

---

## Testing

```bash
bun run test                          # everything
bun test packages/backend/auth/tests/ # one package
bun test --watch packages/backend/auth/
```

New behavior needs a test. Bug fixes need a test that fails before your fix.
We're not dogmatic about coverage numbers, but "how would we know if this
broke" should have an answer.

---

## Opening a PR

1. **Branch off `main`.** Name it whatever you like.
2. **Run the gate locally:** `bun run fix && bun moon run :validate && bun run test`.
3. **Write a description that says why.** The what is in the diff. If it fixes
   an issue, `Fixes #123`.
4. **One concern per PR.** A refactor bundled with a feature takes 5x longer to
   review and is 5x more likely to sit.

Commits inside the PR don't need to be pretty — PRs are squash-merged. The
squash subject is what lands in history, so that one should read well.

### What happens next

The maintainer reviews. Expect real feedback — this codebase is consistent on
purpose and review is where that's kept. If something's asked for that you
disagree with, push back; the reasoning is usually written down somewhere and
if it isn't, that's a gap worth finding.

---

## Assets and licensing

Code is MIT. **Bundled art and audio are not** — they carry CC-BY-SA, CC-BY,
GPL, OGA-BY and other terms. See [LICENSE-ASSETS.md](LICENSE-ASSETS.md).

If you contribute art, it must be compatible with the existing LPC-derived set
and you must be able to state its license and author. Attribution goes in
`apps/frontend/client/static/game-data/asset_credits.json`.

---

## Reporting security issues

Don't open a public issue. See [SECURITY.md](SECURITY.md).

---

## Questions

[Discord](https://discord.gg/XuuhWvSxHH) is the fastest way to get an answer.
Issues work too.
