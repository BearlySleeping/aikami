# Setup Guide

Two very different kinds of "setup" exist in this repo — don't confuse them:

| Command | What it sets up | Who runs it |
| --- | --- | --- |
| `bun run setup` | **Local machine** — checks/installs bun, git, direnv, jdk, chromium, Tauri deps | Everyone (developers) |
| `bun run project:setup` | **GCP cloud project** — APIs, IAM, secrets, Firebase Hosting, Artifact Registry | Maintainers (once per cloud project) |

This page is about **local machine setup**. For cloud infrastructure setup, see [Project Setup (GCP)](#project-setup-gcp) at the bottom or run `bun run project:setup`.

## Quick Start

```bash
# Clone the repo
git clone <repo-url> aikami
cd aikami

# Run the local setup script — a CLI guide that checks your machine
bun run setup
```

The local setup script will:
1. Check essentials (Bun, git)
2. Surface the recommended path: direnv + Nix flake (provides everything)
3. Check agent tools (pi, herdr)
4. Check emulator dependencies (JDK, Chromium) — needed for `bun run dev:all`
5. Check Tauri build dependencies (Rust, webkit2gtk, …) — needed for `bun tauri build`
6. Print copy-paste install commands for anything that's missing

## Recommended path (direnv + Nix)

The repo ships a `flake.nix` + `.envrc` that provides a deterministic dev
shell (bun, jdk, chromium, playwright browsers, tauri deps, gcloud, herdr).
With direnv + nix installed, entering the repo loads everything
automatically — no per-tool installation needed:

```bash
# One-time (the setup script prints the exact commands):
curl -L https://nixos.org/nix/install | sh
nix profile install nixpkgs#direnv nixpkgs#nix-direnv

# Then, inside the repo:
direnv allow
```

Not using direnv? That's fine — `bun run setup` falls back to per-tool
checks and prints the install commands for your platform (apt / brew /
winget). direnv is not something you install on its own; it's the umbrella
that makes the other checks unnecessary.

## Prerequisites

| Tool | Min Version | Install |
| --- | --- | --- |
| Bun | 1.x | `curl -fsSL https://bun.sh/install \| bash` |
| git | any | https://git-scm.com |
| JDK (emulator) | 17+ | `apt-get install openjdk-21-jdk` / `brew install openjdk` |
| Chromium (emulator) | any | `apt-get install chromium` / `brew install --cask chromium` |
| Rust (Tauri, Linux) | stable | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |

Everything below is optional: nix, direnv (the recommended path), pi, herdr,
gcloud.

## Manual Setup

If you prefer to set up manually:

```bash
# 1. Install dependencies
bun install
bun run moon sync

# 2. Create .env from template
cp .env.example .env
# Edit .env with your Firebase project values

# 3. Verify
bun run typecheck
bun run validate
```

## Daily Development

```bash
bun run dev        # Start Client dev server
bun run dev:all    # Start all services (firebase + Client)
bun run test       # Run tests
bun run typecheck  # Typecheck all projects
bun run fix        # Auto-fix lint/format issues
```

## CI Mode

In CI environments (`CI=true`), the setup script runs non-interactively:

```bash
CI=true bun run setup
```

## Troubleshooting

- **Typecheck errors after setup**: Run `bun run fix` then try again
- **Moon sync fails**: Delete `.moon/cache` and re-run `bun run moon sync`
- **Firebase emulator issues**: Run `firebase emulators:start` manually
- **Port conflicts**: Check if another instance of the dev server is running

## Project Setup (GCP)

Cloud infrastructure setup is a separate, maintainer-only flow. It enables
GCP APIs, grants IAM roles, creates secrets, Firebase Hosting sites, and the
Artifact Registry Docker repository:

```bash
bun run project:setup                      # Full interactive wizard
bun run project:setup --mode=staging       # Target a specific mode
bun run project:setup --mode=staging --dry-run  # Check only, no changes
```

Source: `scripts/src/lib/project_setup/`
