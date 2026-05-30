# GameJS - Strict Coding Standard

> **Protocol**: Before any GameJS task, first consult the [Root AGENTS.md](../../../../../AGENTS.md) for shared monorepo standards, then apply this GameJS-specific standard on top.

---

## 1. Architecture Principles

### File Path Comments (Mandatory)
Every file must include its relative path from the monorepo root as a comment at the very top:

```typescript
// apps/frontend/gamejs/src/core/firebase_auth.ts
import { Node } from 'godot';
```

```typescript
// apps/frontend/gamejs/src/interface/auth/login_view.ts
import { Button } from 'godot';
```

### Project Structure
```
src/
├── core/           # Autoload singletons (Env, Firebase*, GameState, Managers)
├── interface/      # UI views (menus, HUD, auth screens)
│   ├── auth/       # Authentication views
│   └── menus/      # Menu views
├── scenes/         # Game scenes (.tscn + .ts)
│   ├── main/       # Main game scenes
│   └── test/       # Test/debug scenes
├── entities/       # Game entities (player, enemies, items)
├── systems/        # Game systems (combat, physics, AI)
├── utils/          # Utility functions, helpers, constants
└── components/     # Reusable Godot components
```

---

## 2. Class Structure & Ordering

Classes must follow this exact member ordering:

```typescript
export default class Example extends Node {
  // 1. Static fields (private → public)
  private static _instance: Example | null = null;

  // 2. Instance fields (private → protected → public)
  private _currentUser: FirebaseUser | null = null;
  private _speed = 100;

  // 3. Getters / Setters (public → private)
  static get instance(): Example | null {
    return Example._instance;
  }

  get isAuthenticated(): boolean {
    return this._currentUser !== null;
  }

  // 4. Godot lifecycle methods (in order: _ready, _enter_tree, _process, _physics_process, _input, _exit_tree)
  _ready(): void {
    this.debug('_ready');
    Example._instance = this;
    this.initialize();
  }

  _process(_delta: number): void {
    // Frame update logic
  }

  // 5. Public methods (alphabetical)
  async authenticate(options: { email: string; password: string }): Promise<boolean> {
    this.debug('authenticate', options);
    // implementation
  }

  signOut(): void {
    this.debug('signOut');
    this._currentUser = null;
  }

  // 6. Private methods (alphabetical, grouped by concern if needed)
  private async _fetchUserData(options: { uid: string }): Promise<UserData | null> {
    this.debug('_fetchUserData', options);
    // implementation
  }

  private _initialize(): void {
    this.debug('_initialize');
    // implementation
  }
}
```

---

## 3. Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Files | kebab-case | `player-controller.ts`, `login-view.ts` |
| Classes | PascalCase | `PlayerController`, `LoginView` |
| Public methods | camelCase | `signIn()`, `loadGame()` |
| **Private methods** | **underscore + camelCase** | `_fetchData()`, `_onButtonPressed()` |
| **Private fields** | **underscore + camelCase** | `_currentUser`, `_httpClient` |
| Constants (true) | SCREAMING_SNAKE_CASE | `MAX_RETRY_COUNT`, `SESSION_KEY` |
| Constants (readonly config) | camelCase | `defaultTimeout` |
| Types | PascalCase | `AuthOptions`, `UserData` |
| Interfaces (rare) | PascalCase +`Interface` suffix | `AuthServiceInterface` |
| Godot node references | PascalCase matching scene | `StartButton`, `HealthBar` |
| Scene files | kebab-case | `main-menu.tscn`, `login-view.tscn` |

---

## 4. Function & Method Rules

### Arrow Functions Default
Use `const` arrow functions everywhere **except** inside classes where you need `this`/`super` binding:

```typescript
// ✅ STANDALONE / UTILITY: Arrow function
const calculateDamage = (options: { base: number; defense: number }): number => {
  return Math.max(0, options.base - options.defense);
};

// ✅ CLASS: Regular function (needs this/super)
class Player extends Node {
  _ready(): void {
    super._ready();
    this._setupInput();
  }

  // ✅ Private helper inside class: arrow function (no this needed)
  private _setupInput = (): void => {
    // But prefer regular private methods for consistency
  };
}
```

### Options Object (Mandatory)
All functions/methods with **more than one argument** must use an options object:

```typescript
// ❌ WRONG
function movePlayer(x: number, y: number, speed: number): void { }

// ✅ CORRECT
interface MovePlayerOptions {
  x: number;
  y: number;
  speed: number;
}

function movePlayer(options: MovePlayerOptions): void {
  const { x, y, speed } = options;
  // ...
}

// Even single arguments in public APIs should use options for consistency:
interface SaveGameOptions {
  gameId: string;
}

async function saveGame(options: SaveGameOptions): Promise<void> { }
```

### Escape Early (No Else)
Never use `else` when you can return early:

```typescript
// ❌ WRONG
function processUser(user: User | null): void {
  if (user) {
    doSomething(user);
  } else {
    handleError();
  }
}

// ✅ CORRECT
function processUser(user: User | null): void {
  if (!user) {
    handleError();
    return;
  }
  doSomething(user);
}
```

---

## 5. TypeScript Strictness

### Type over Interface
Always use `type` by default. Only use `interface` when you need `extends` or class implementation:

```typescript
// ✅ CORRECT
type AuthResponse = {
  idToken?: string;
  email?: string;
};

// ✅ CORRECT (needs extends)
interface BaseServiceInterface {
  initialize(): Promise<void>;
}

interface CharacterServiceInterface extends BaseServiceInterface {
  loadCharacter(options: { id: string }): Promise<Character>;
}
```

### Never `any`
```typescript
// ❌ WRONG
function parseData(data: any): any { }

// ✅ CORRECT
function parseData(data: unknown): ParsedData | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  // Use type guards
}
```

### Never `null`
Prefer `undefined` everywhere:
```typescript
// ❌ WRONG
let user: User | null = null;

// ✅ CORRECT
let user: User | undefined = undefined;
```

### Never non-null assertion (`!`)
```typescript
// ❌ WRONG
const node = this.get_node('Button')!;

// ✅ CORRECT
const node = this.get_node('Button');
if (!node) {
  logger.error('Button not found');
  return;
}
```

### `as const` and `satisfies`
Use `as const` for constant arrays/objects and `satisfies` for type-checking without widening:

```typescript
// ✅ CORRECT
const VALID_KEYS = ['up', 'down', 'left', 'right'] as const;
type Direction = (typeof VALID_KEYS)[number];

// ✅ CORRECT
const config = {
  apiUrl: 'http://localhost:8080',
  timeout: 5000,
} satisfies { apiUrl: string; timeout: number };
```

---

## 6. Documentation (JSDoc)

### Required JSDoc

| Element | JSDoc Required |
|---------|---------------|
| Classes | ✅ Yes — purpose, extends, description |
| Public methods | ✅ Yes — params, return, description |
| Public properties (singletons/autoloads) | ✅ Yes — description |
| Complicated private methods | ✅ Yes — explain algorithm or edge cases |
| Simple private getters/setters | ❌ No |
| Simple private fields | ❌ No |

### JSDoc Template

```typescript
/**
 * @fileoverview Firebase authentication service for GameJS
 * @description Manages user authentication via Firebase REST API.
 * Supports anonymous, email/password, and Google sign-in.
 * @module firebase_auth
 */

/**
 * @class FirebaseAuth
 * @extends Node
 * @description Singleton autoload service for Firebase Authentication.
 * Stores session in user:// directory for persistence.
 */
export default class FirebaseAuth extends Node {
  /**
   * @property {FirebaseUser | null} _currentUser
   * @private
   * @description Currently authenticated user. Null if not signed in.
   */
  private _currentUser: FirebaseUser | null = null;

  /**
   * @method sign_in_with_email
   * @async
   * @param {SignInEmailOptions} options - Sign-in configuration
   * @param {string} options.email - User email address
   * @param {string} options.password - User password
   * @returns {Promise<FirebaseUser | null>} Authenticated user or null on failure
   */
  async sign_in_with_email(options: SignInEmailOptions): Promise<FirebaseUser | null> {
    this.debug('sign_in_with_email', options);
    // ...
  }
}
```

---

## 7. Logging (Mandatory)

Every method must log its name and arguments at the start:

```typescript
// In services/classes that extend BaseClass or similar
async loadGame(options: { gameId: string }): Promise<SaveData | null> {
  this.debug('loadGame', options);
  // ... implementation
}

// Standalone functions
import { logger } from '$logger';

function calculateDamage(options: { base: number; defense: number }): number {
  logger.debug('calculateDamage', options);
  // ... implementation
}
```

---

## 8. Error Handling

### Views (Outer Layer): Try-Catch + Rethrow
All view methods must have try-catch and rethrow with context:

```typescript
async _on_sign_in_pressed(): Promise<void> {
  this.debug('_on_sign_in_pressed');
  try {
    const user = await this._auth.sign_in_with_email({ email, password });
    if (!user) {
      throw new Error('Authentication returned null');
    }
    this._go_to_main_menu();
  } catch (error) {
    logger.error('LoginView: _on_sign_in_pressed failed', { email, error });
    this._show_status('Sign-in failed. Please try again.', true);
    // Rethrow if needed for upstream handling
    throw error;
  }
}
```

### Services (Inner Layer): Throw Errors
Methods called by views should throw errors for the view to catch:

```typescript
async fetch_leaderboard(options: { gameId: string }): Promise<LeaderboardEntry[]> {
  this.debug('fetch_leaderboard', options);

  const http = this._get_http();
  if (!http) {
    throw new Error('FirebaseHttpClient not available');
  }

  // ... implementation that throws on failure
}
```

---

## 9. GodotJS-Specific Rules

### Default Export
Every script must export a single class as default:

```typescript
// ✅ CORRECT
export default class PlayerController extends CharacterBody2D {
  // ...
}
```

### Signal Connections
Use `Callable.create()` — never arrow functions capturing `this`:

```typescript
// ❌ WRONG
button.pressed.connect(() => this._on_pressed());

// ✅ CORRECT
button.pressed.connect(Callable.create(this, this._on_pressed), 0);
```

### Node Access
Always use `unique_name_in_owner` with `%` prefix in scenes, then access via `get_node()`:

```typescript
// In scene: Button with unique_name_in_owner = "StartButton"
private _startButton!: Button;

_ready(): void {
  this._startButton = <Button>this.get_node('%StartButton');
}
```

### Godot Lifecycle Override
Always call `super` when overriding lifecycle methods:

```typescript
_ready(): void {
  super._ready();
  this.debug('_ready');
  this._initialize();
}
```

### File Access Constants
Use named constants for FileAccess modes:

```typescript
const FILE_READ = 1;   // FileAccess.READ
const FILE_WRITE = 2;  // FileAccess.WRITE

const file = FileAccess.open(path, FILE_READ);
```

---

## 10. Import Ordering

```typescript
// 1. External libraries (none in GodotJS usually)
// 2. Godot modules
import { Node, Button, Callable, OS } from 'godot';

// 3. Internal absolute imports (path aliases)
import { logger } from '$logger';

// 4. Relative imports (explicit extensions)
import FirebaseAuth from '../../core/firebase_auth';
import { type AuthOptions } from '../types/auth';
```

---

## 11. Formatting (Biome)

> **Note**: Biome is currently disabled for gamejs. To enable, update `biome.json` override.

When enabled, gamejs uses these settings (from root `biome.json`):

| Setting | Value |
|---------|-------|
| Indent | 4 spaces |
| Line width | 120 characters |
| Quotes | Single for TS |
| Trailing commas | All (ES5 style) |
| Semicolons | Always |
| Arrow parentheses | Always |

Run formatting:
```bash
bun run format
# or
bun run fix
```

---

## 12. Anti-Patterns (Strictly Forbidden)

| Pattern | Why | Alternative |
|---------|-----|-------------|
| `any` type | Loses type safety | `unknown` + type guards |
| `as unknown as Type` | Hides real issues | Fix root cause or create transformation function |
| `null` | Inconsistent with rest of codebase | `undefined` |
| `!` non-null assertion | Unsafe | Early return or optional chaining |
| `interface` default | Unnecessary | `type` unless extending |
| Positional args (2+) | Hard to refactor | Options object |
| Single-line `if` | Error-prone | Always use `{}` |
| `else` after early return | Unnecessary nesting | Return early |
| Arrow functions in `Callable.create()` | Memory leak | `Callable.create(this, this.method)` |
| Raw JS objects to Godot signals | Type mismatch | `GDictionary.create()` or `GArray.create()` |
| Missing default export | Godot won't recognize script | `export default class ...` |
| No file path comment | Missing context | `// apps/frontend/gamejs/src/...` |
| No method logging | Hard to debug | `this.debug('methodName', options)` |

---

## 13. Testing Standards

### Unit Tests (Bun)
```typescript
// tests/damage.test.ts
import { describe, expect, test } from 'bun:test';
import { calculateDamage } from '../src/utils/combat';

describe('calculateDamage', () => {
  test('returns positive damage when attack exceeds defense', () => {
    expect(calculateDamage({ base: 100, defense: 50 })).toBe(50);
  });

  test('returns zero when defense exceeds attack', () => {
    expect(calculateDamage({ base: 50, defense: 100 })).toBe(0);
  });

  test('returns zero for equal values', () => {
    expect(calculateDamage({ base: 50, defense: 50 })).toBe(0);
  });
});
```

### Scene Tests
Create dedicated test scenes in `src/scenes/test/` with `_ready()` running assertions and logging results.

---

## 14. Summary Checklist

Before committing any GameJS code, verify:

- [] File path comment at top
- [] Default export present
- [] All private members prefixed with `_`
- [] Options object used for multi-arg methods
- [] Arrow functions used outside classes
- [] `type` preferred over `interface`
- [] No `any`, `null`, or `!` assertions
- [] Early returns, no unnecessary `else`
- [] JSDoc on classes, public methods, complex private methods
- [] Logging at start of every method
- [] Try-catch in view methods with rethrow
- [] `Callable.create()` for signal connections
- [] Build passes: `bun run build`

---

## References

- **Root Standards**: [AGENTS.md](../../../../../AGENTS.md) — Shared monorepo conventions
- **GodotJS Skill**: `.opencode/skills/godotjs-scripting/SKILL.md` — GodotJS-specific patterns
- **GodotJS TDD**: `.opencode/skills/godotjs-tdd/SKILL.md` — Test-driven development workflow
- **Code Standards Skill**: `.opencode/skills/code-standards/SKILL.md` — General TypeScript conventions
- **Biome Config**: `biome.json` — Formatter/linter rules
- **Google TypeScript Style**: https://google.github.io/styleguide/tsguide.html
- **Unicorn ESLint Rules**: https://github.com/sindresorhus/eslint-plugin-unicorn
