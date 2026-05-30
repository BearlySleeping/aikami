# Setup Guide

Developer onboarding for the Aikami monorepo.

## Quick Start

```bash
# Clone the repo
git clone <repo-url> aikami
cd aikami

# Run the setup script
bun run setup
```

The setup script will:
1. Check prerequisites (Bun, Node.js, git, Firebase CLI)
2. Install dependencies (`bun install` + `bun moon sync`)
3. Configure your `.env` file with Firebase project settings
4. Verify the setup (typecheck + lint)

## Prerequisites

| Tool | Min Version | Install |
|------|-------------|---------|
| Bun | 1.x | `curl -fsSL https://bun.sh/install \| bash` |
| Node.js | 22.x | Comes with Bun |
| git | any | https://git-scm.com |
| Firebase CLI | any (optional) | `npm install -g firebase-tools` |

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
bun run dev        # Start PWA dev server
bun run dev:all    # Start all services (emulators + PWA)
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
