# Setup Guide

**The short version:** you need Bun. Everything else is optional.

```bash
git clone https://github.com/BearlySleeping/aikami && cd aikami
bun install
bun run setup:env    # writes local .env files — no cloud account needed
bun run dev          # → http://localhost:5173
```

If that worked, you're set up. The rest of this page is for when it didn't, or
when you want the fuller toolchain.

---

## Three different "setups" — don't confuse them

| Command | What it sets up | Who runs it |
| --- | --- | --- |
| `bun run setup` | **Your machine** — checks bun, git, direnv, JDK, Chromium, Tauri deps | Anyone, optional |
| `bun run stack init` | **Local AI engines** (Docker) — text/image/voice | Only if you want local models |
| `bun run project:setup` | **Cloud infrastructure** — GCP Secret Manager, IAM, Artifact Registry | Maintainers, once per project |

This page is about the first one. For local AI engines see the
[Local Stack README](../../apps/backend/local-stack/README.md). Cloud setup is
at the [bottom](#cloud-project-setup-maintainers).

---

## Tooling tiers

You do not need all of this. Pick your depth:

| Tier | Add | Buys you |
| --- | --- | --- |
| **0 — required** | Bun 1.3+ | Everything builds, tests, lints, runs. Enough to ship a PR. |
| **1 — recommended** | Nix + direnv | The whole toolchain, pinned, with one command. |
| **2 — optional** | pi + herdr | The maintainer's loop: contract pipeline, multi-pane dev sessions, autofix. |

`bun run setup` checks all three tiers and prints install commands for what's
missing. **Tier-2 lines are informational** — no PR review will ever ask you to
install pi or herdr.

---

## Tier 0 — just Bun

```bash
curl -fsSL https://bun.sh/install | bash    # Linux / macOS
powershell -c "irm bun.sh/install.ps1 | iex" # Windows
```

Then `bun install && bun run setup:env && bun run dev`.

`bun run setup:env` writes each app's `.env.emulator` from its `.env.example`,
filling in safe fake values for anything required at runtime. The
`demo-aikami-emulator` project isn't real, so **no cloud account or `gcloud`
login is involved.** Re-running it never clobbers values you've customized — it
only fills in what's still missing.

> ⚠️ **Not using the Nix flake?** The first `bun moon run ...` will otherwise
> have moon download its own separate "latest" Bun via proto, alongside the one
> you already installed. Set `MOON_TOOLCHAIN_FORCE_GLOBALS=true` in your shell
> profile to make moon use yours. `flake.nix` sets this automatically, and CI
> does the same.

---

## Tier 1 — Nix + direnv (recommended)

The repo ships a `flake.nix` + `.envrc` providing a deterministic dev shell
(bun, jdk, chromium, playwright browsers, tauri deps, postgres, gcloud, herdr).
Entering the repo directory loads all of it — no per-tool installation:

```bash
# One-time (bun run setup prints the exact commands for your platform):
curl -L https://nixos.org/nix/install | sh
nix profile install nixpkgs#direnv nixpkgs#nix-direnv

# Then, inside the repo:
direnv allow
```

Not using direnv? Fine — `bun run setup` falls back to per-tool checks and
prints install commands for apt / brew / winget.

---

## Tier 2 — pi + herdr (optional)

This is how the maintainer works, not a requirement.

- **[pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)** — the coding agent that runs the contract pipeline (`bun run contract`)
- **[herdr](https://github.com/ogulcancelik/herdr)** — multi-pane dev session manager (`bun run herdr:dev`)

```bash
npm install -g @earendil-works/pi-coding-agent
nix profile install github:ogulcancelik/herdr
```

Without them you use `bun run dev`, `bun moon run hub:dev`, etc. directly.
Nothing is gated.

---

## Prerequisites by task

| Task | Needs |
| --- | --- |
| Build, test, lint, run the client | **Bun only** |
| Run E2E / visual tests | + JDK 17+, Chromium (or tier 1) |
| Build the desktop app | + Rust stable, webkit2gtk (Linux) / MSVC Build Tools (Windows) |
| Run local AI models | + Docker |
| Deploy | + `wrangler`, cloud credentials (maintainers) |

| Tool | Min | Install |
| --- | --- | --- |
| Bun | 1.3+ | `curl -fsSL https://bun.sh/install \| bash` |
| git | any | https://git-scm.com |
| JDK | 17+ | `apt install openjdk-21-jdk` / `brew install openjdk` |
| Chromium | any | `apt install chromium` / `brew install --cask chromium` |
| Rust | stable | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |

---

## Windows

Supported and regularly used — the contract pipeline, the emulator, and Tauri
builds all run there.

```bash
git config --global core.longpaths true
```

`bun run setup` additionally checks for Git Bash and directory-junction support
and tells you if something's off. If you'd rather use the Nix devShell, run the
repo under WSL.

macOS is expected to work but is **not currently tested** — reports welcome via
the [setup/DX issue template](https://github.com/BearlySleeping/aikami/issues/new/choose).

---

## Manual setup

If you prefer to do it by hand:

```bash
bun install
bun run moon sync
bun run setup:env      # or copy each apps/*/.env.example to .env.emulator yourself
bun run typecheck
bun moon run :validate
```

---

## Daily development

```bash
bun run dev              # client dev server
bun moon run hub:dev     # hub dev server
bun run test             # all tests
bun run typecheck        # typecheck all projects
bun run fix              # auto-fix lint/format (Biome)
bun moon run :validate   # the full gate
```

See [Developer Workflow](../guides/dev-workflow.md) for the full command set.

---

## CI mode

In CI (`CI=true`) the setup script runs non-interactively:

```bash
CI=true bun run setup
```

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Typecheck errors right after setup | `bun run fix`, then retry |
| Moon sync fails | `rm -rf .moon/cache && bun run moon sync` |
| Moon downloads a second Bun | Set `MOON_TOOLCHAIN_FORCE_GLOBALS=true` |
| Port already in use | Another dev server is running — `bun run herdr:stop`, or kill the port |
| Windows path-length errors | `git config --global core.longpaths true` |

Still stuck? Open a
[setup/DX issue](https://github.com/BearlySleeping/aikami/issues/new/choose) —
those reports are disproportionately useful, because setup breakage is nearly
invisible from an already-configured machine.

---

## Cloud project setup (maintainers)

Cloud infrastructure is a separate, maintainer-only flow. Application hosting
runs on **Cloudflare Workers** (client, hub, site, docs) with **D1** and **R2**;
`wrangler` handles those. GCP is still used for **Secret Manager** and
**Artifact Registry** (the Docker engine images), which is what this wizard
bootstraps:

```bash
bun run project:setup                            # full interactive wizard
bun run project:setup --mode=staging             # target a specific mode
bun run project:setup --mode=staging --dry-run   # check only, no changes
```

Contributors never need this. `bun run setup:env` gives you a working local
build with zero cloud access.
