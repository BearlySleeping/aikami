# GameJS - GodotJS Game Project

A GodotJS game using TypeScript for game logic, compiled to JavaScript for the web and native platforms.

## Quick Start

```bash
# Download Godot templates (first time only)
bun run template:download

# Build and run in development
bun run dev:run

# Export for web and serve
bun run export:web
bun run export:serve
# Open http://localhost:3000
```

## Project Structure

```
gamejs/
├── src/                    # TypeScript source (game logic)
│   ├── core/               # Core systems (game state, managers)
│   └── scenes/             # Game scenes (.tscn + .ts scripts)
├── tests/                  # Unit tests (bun test)
├── dist/                   # Exported builds
│   ├── linux/             # Linux binary + game.pck
│   └── web/                # Web export (HTML + WASM)
├── templates/              # Godot templates (downloaded)
├── scripts/                # Build scripts
│   ├── download-template.ts
│   ├── export.ts
│   └── serve.ts
├── project.godot           # Godot project config
└── package.json            # npm scripts
```

## Commands

### Development

| Command | Description |
|---------|-------------|
| `bun run dev` | Build TypeScript → JS |
| `bun run dev:watch` | Watch mode (rebuild on changes) |
| `bun run dev:editor` | Open Godot editor |
| `bun run dev:run` | Build + run (headless) |

### Templates

| Command | Description |
|---------|-------------|
| `bun run template:download` | Download missing templates (interactive) |
| `bun run template:list` | List available templates |
| `bun run template:download:linux` | Download Linux template |
| `bun run template:download:web` | Download web template |
| `bun run template:download:all` | Download all templates |
| `bun run template:download:force` | Force re-download all |

### Export

| Command | Description |
|---------|-------------|
| `bun run export` | Export for current OS + web (interactive) |
| `bun run export:linux` | Export for Linux |
| `bun run export:web` | Export for Web |
| `bun run export:all` | Export for all platforms (parallel) |
| `bun run export:serve` | Serve web export at localhost:3000 |
| `bun run export:list` | List export options |
| `bun run export:clean` | Clean dist/ folder |

### Testing & Linting

| Command | Description |
|---------|-------------|
| `bun run test` | Run unit tests (bun test) |
| `bun run test:godot` | Run GodotJS tests (requires tests=yes build) |

#### Unit Tests

Write tests in TypeScript using bun:

```typescript
// tests/game-logic.test.ts
import { describe, expect, test } from 'bun:test';

function addScore(score: number, points: number): number {
  return score + points;
}

describe('Game Logic', () => {
  test('adds points to score', () => {
    expect(addScore(0, 100)).toBe(100);
  });
});
```

#### GodotJS Tests

For runtime tests in Godot, you need a Godot build with `tests=yes`:

```bash
# Build Godot with tests (requires compiling from source)
scons tests=yes dev_build=yes p=linux

# Run tests
bun run test:godot
# or
godot --headless --test --test-case="[jsb]*"
```

This requires compiling GodotJS with the `tests=yes` flag.
| `bun run lint:fix` | Auto-fix lint issues |
| `bun run format` | Check formatting |
| `bun run format:fix` | Auto-format code |
| `bun run typecheck` | TypeScript check |
| `bun run validate` | Full validation (lint + typecheck) |

## Web Server

The web export requires COOP/COEP headers. Use the built-in server:

```bash
bun run export:serve
# Opens http://localhost:3000
```

Or use any static server with these headers:
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

## Game Scripts

Write game logic in TypeScript:

```typescript
// src/scenes/main.ts
import { Node } from "godot";

export default class Main extends Node {
  _ready(): void {
    console.log("Game loaded!");
  }

  on_click_me(): void {
    console.log("Button clicked!");
  }
}
```

Scene connections are defined in `.tscn` files:

```tscn
[node name="ClickMe" type="Button" parent="."]
text = "Click Me!"

[connection signal="pressed" from="ClickMe" to="." method="on_click_me"]
```

## Requirements

- Bun (runtime)
- Python 3 (for template extraction)

### NixOS

This project uses [godotjs-nix](https://github.com/snorreks/godotjs-nix) for Godot.

With your existing `godotjs-nix` setup, just run:

```bash
# Build and run
bun run dev:run

# Export for Linux
bun run export:linux

# Run the export
./dist/linux/game
```

### Without godotjs-nix

Install godotjs-nix first:
```bash
nix run github:snorreks/godotjs-nix
```

Or add to your NixOS config:
```nix
{
  inputs.godotjs-nix.url = "github:snorreks/godotjs-nix";
  environment.systemPackages = [ godotjs-nix.packages.x86_64-linux.default ];
}
```

### Library Errors

If you see X11/Wayland errors, run headless:
```bash
./dist/linux/game --headless
```
