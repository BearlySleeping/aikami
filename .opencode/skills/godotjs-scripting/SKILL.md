---
name: godotjs-scripting
description: Best practices, syntax rules, and examples for writing TypeScript/JavaScript scripts in Godot using the Godot.js framework. Includes project setup, patterns, testing, and advanced topics.
version: 1.1.0
author: Aikami Team
tags: ["godot", "gamedev", "typescript", "javascript", "godotjs", "game-engine"]
---

# Godot.js Scripting Skill

This skill provides comprehensive guidelines for writing Godot scripts using TypeScript via the **GodotJS** framework.

## 1. Project Setup

### Directory Structure

```
project/
├── src/
│   ├── entities/
│   │   ├── Player.ts
│   │   ├── Enemy.ts
│   │   └── Item.ts
│   ├── ui/
│   │   ├── HUD.ts
│   │   └── Menu.ts
│   ├── systems/
│   │   ├── GameManager.ts
│   │   ├── SaveSystem.ts
│   │   └── AudioManager.ts
│   ├── utils/
│   │   ├── constants.ts
│   │   └── helpers.ts
│   └── index.ts
├── assets/
│   ├── scenes/
│   ├── scripts/
│   └── resources/
├── project.godot
└── tsconfig.json
```

### TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": false,
    "noEmit": false
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

---

## 2. Class Definition & Lifecycle

### Default Export Required

Every script must export a single class as the default export:

```typescript
import { Node } from "godot";

export default class MyNode extends Node {
  _ready() {
    console.log("Ready!");
  }
  
  _process(delta: number) {
    // Called every frame
  }
}
```

### Constructors

Avoid explicit constructors if possible. If needed, define with explicit identifier:

```typescript
import { Node } from "godot";

export default class MyNode extends Node {
  private _speed: number = 100;
  
  constructor(identifier?: any) {
    super(identifier);
    console.log("Constructor called");
  }
  
  _ready() {
    // Initialization logic
  }
}
```

### Lifecycle Methods

| Method | Description |
|--------|-------------|
| `_ready()` | Called when node enters scene tree |
| `_process(delta)` | Called every frame |
| `_physics_process(delta)` | Called every physics frame |
| `_enter_tree()` | Called when entering tree |
| `_exit_tree()` | Called when exiting tree |
| `_draw()` | Called for custom drawing |
| `_input(event)` | Called for input handling |

---

## 3. Decorators & Annotations

Use decorators from `"godot.annotations"`:

### @Export

Expose variables to the Godot Editor. **MUST** explicitly provide the type:

```typescript
import { Variant } from "godot";
import { Export, ExportEnum } from "godot.annotations";

@Export(Variant.Type.TYPE_FLOAT)
speed: number = 10.0;

@Export(Variant.Type.TYPE_STRING)
characterName: string = "Player";

@Export(Variant.Type.TYPE_INT)
maxHealth: number = 100;

// For enums
@ExportEnum(MyColorEnum)
color: MyColorEnum = MyColorEnum.White;
```

### @Tool

Run scripts inside the Godot editor:

```typescript
import { Tool } from "godot.annotations";

@Tool()
export default class EditorTool extends Node {
  _process(delta: number) {
    // Preview in editor
    console.log("Tool mode active");
  }
}
```

### @Icon

Assign custom icon in Scene Tree:

```typescript
import { Icon } from "godot.annotations";

@Icon("res://icon.svg")
export default class CustomNode extends Node {}
```

---

## 4. Signals

### Declaration

Use `@ExportSignal` and `declare`:

```typescript
import { Signal } from "godot";
import { ExportSignal } from "godot.annotations";

@ExportSignal()
declare my_signal!: Signal<(param: string) => void>;

@ExportSignal()
declare health_changed!: Signal<(current: number, max: number) => void>;
```

### Emitting Signals

**Important**: Wrap data in Godot structures (`GDictionary`, `GArray`):

```typescript
import { GDictionary } from "godot";

// ❌ WRONG: this.my_signal.emit({ key: "val" })

// ✅ CORRECT:
this.my_signal.emit(GDictionary.create({ key: "val" }));

// For multiple parameters:
this.health_changed.emit(GDictionary.create({ 
  current: this.currentHealth, 
  max: this.maxHealth 
}));
```

### Connecting Signals

Use `Callable.create()`. **Never** capture `this` in arrow functions:

```typescript
import { Callable } from "godot";

this.get_node("Button").pressed.connect(
  Callable.create(this, this.handle_click),
  0  // Connection flags
);

// Disconnecting
this.get_node("Button").pressed.disconnect(
  Callable.create(this, this.handle_click)
);
```

### Awaiting Signals

Use `.as_promise()`:

```typescript
async waitForSignal() {
  const result = await this.my_signal.as_promise();
  console.log("Signal received:", result);
}
```

---

## 5. Node Types & Common Classes

### Common Godot Classes

```typescript
import { 
  Node, 
  Node2D, 
  Node3D, 
  Sprite2D, 
  RigidBody2D, 
  Area2D,
  Control,
  CanvasItem,
} from "godot";
```

### Creating Nodes in Code

```typescript
import { Sprite2D, Texture2D, Node } from "godot";

export default class GameManager extends Node {
  private _sprite!: Sprite2D;
  
  _ready() {
    // Create node programmatically
    this._sprite = new Sprite2D();
    this._sprite.name = "PlayerSprite";
    this.add_child(this._sprite);
  }
}
```

---

## 6. Input Handling

### Keyboard Input

```typescript
import { Input, InputEventKey } from "godot";

export default class PlayerController extends Node {
  private _speed: number = 200;
  
  _process(delta: number) {
    const input = Input.get_vector(
      "ui_left",   // negative x
      "ui_right",  // positive x
      "ui_up",     // negative y
      "ui_down"    // positive y
    );
    
    // Or check specific actions
    if (Input.is_action_pressed("ui_accept")) {
      console.log("Jump!");
    }
    
    if (Input.is_action_just_pressed("ui_cancel")) {
      console.log("Menu opened!");
    }
  }
}
```

### Mouse/Touch Input

```typescript
export default class ClickHandler extends Node {
  _input(event: InputEvent) {
    if (event is InputEventMouseButton) {
      if (event.button_index === MouseButton.LEFT && event.pressed) {
        console.log("Left click at:", event.position);
      }
    }
    
    if (event is InputEventMouseMotion) {
      console.log("Mouse moved to:", event.position);
    }
  }
}
```

---

## 7. Physics

### 2D Physics

```typescript
import { RigidBody2D, CharacterBody2D, PhysicsBody2D } from "godot";

export default class Player extends CharacterBody2D {
  private _speed: number = 300;
  private _jumpForce: number = -500;
  
  _physics_process(delta: number) {
    // Get input direction
    const direction = Input.get_axis("ui_left", "ui_right");
    
    // Apply velocity
    this.velocity.x = direction * this._speed;
    
    // Jump
    if (Input.is_action_just_pressed("ui_accept") && this.is_on_floor()) {
      this.velocity.y = this._jumpForce;
    }
    
    // Apply gravity
    this.velocity.y += this.get_gravity() * delta;
    
    // Move and slide
    this.move_and_slide();
  }
}
```

---

## 8. File & Storage

### Save/Load System

```typescript
import { FileAccess, JSON } from "godot";

interface SaveData {
  playerPosition: { x: number; y: number };
  health: number;
  level: number;
}

export default class SaveSystem extends Node {
  private _savePath: string = "user://savegame.json";
  
  saveGame(data: SaveData): void {
    const json = JSON.stringify(data);
    const file = FileAccess.open(this._savePath, FileAccess.ModeFlags.WRITE);
    if (file) {
      file.store_string(json);
      file.close();
    }
  }
  
  loadGame(): SaveData | null {
    const file = FileAccess.open(this._savePath, FileAccess.ModeFlags.READ);
    if (!file) return null;
    
    const json = file.get_as_text();
    file.close();
    
    const parsed = JSON.parse(json);
    return parsed.result as SaveData;
  }
}
```

---

## 9. Animation

### AnimationPlayer

```typescript
import { AnimationPlayer } from "godot";

export default class AnimatedCharacter extends Node {
  private _animPlayer!: AnimationPlayer;
  
  _ready() {
    this._animPlayer = this.get_node("AnimationPlayer") as AnimationPlayer;
  }
  
  playAnimation(name: string): void {
    if (this._animPlayer.has_animation(name)) {
      this._animPlayer.play(name);
    }
  }
  
  stopAnimation(): void {
    this._animPlayer.stop();
  }
  
  isPlaying(): boolean {
    return this._animPlayer.is_playing();
  }
}
```

---

## 10. NPM Dependencies

### Using External Packages

GodotJS doesn't run Node.js natively. Standard Node libraries won't work.

**Solution**: Bundle in separate file:

```typescript
// npm.bundle.ts
export { default as dayjs } from "dayjs";
export { default as lodash } from "lodash";

// my_script.ts
import { dayjs, lodash } from "./npm.bundle";

// Use normally
const date = dayjs().format("YYYY-MM-DD");
const sorted = lodash.sortBy(array, "name");
```

---

## 11. Testing

### Unit Testing

```typescript
// tests/Player.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Player', () => {
  let player: Player;
  
  beforeEach(() => {
    // Setup
    player = new Player();
  });
  
  it('should take damage', () => {
    const initialHealth = player.health;
    player.takeDamage(10);
    expect(player.health).toBe(initialHealth - 10);
  });
  
  it('should not go below zero health', () => {
    player.takeDamage(1000);
    expect(player.health).toBe(0);
  });
});
```

---

## 12. Anti-Patterns to Avoid

1. ❌ **Memory Leaks**: Never write `new Callable(this, () => this.func())` - use `Callable.create(this, this.func)`

2. ❌ **Missing Default Export**: Always export a default class - Godot won't recognize the script

3. ❌ **Missing Variant Types**: Always pass `Variant.Type` to `@Export` - TS types are stripped at runtime

4. ❌ **Raw JS Objects**: Never emit pure JS objects into Godot methods - use `GDictionary.create()` or `GArray.create()`

5. ❌ **Synchronous File I/O**: Use async patterns where possible

6. ❌ **Missing Null Checks**: Always check if nodes exist before accessing them

---

## 13. Godot ↔ TypeScript Type Mapping

| Godot Type | TypeScript Type |
|------------|-----------------|
| `int` | `number` |
| `float` | `number` |
| `String` | `string` |
| `bool` | `boolean` |
| `Array` | `GArray` |
| `Dictionary` | `GDictionary` |
| `Vector2` | `Vector2` |
| `Vector3` | `Vector3` |
| `Node` | `Node` |
| `null` | `null` / `undefined` |

---

## 14. Common Issues & Solutions

### Issue: "Cannot read property X of undefined"

**Solution**: Always check for node existence:

```typescript
const node = this.get_node("MyNode");
if (node) {
  node.doSomething();
}
```

### Issue: "Signal not emitted"

**Solution**: Ensure signal is declared with `@ExportSignal` and uses `declare`:

```typescript
@ExportSignal()
declare my_signal!: Signal<(value: number) => void>;
```

### Issue: "Property not showing in Inspector"

**Solution**: Ensure `@Export` decorator is used with correct Variant type:

```typescript
@Export(Variant.Type.TYPE_INT)
myProperty: number = 10;
```
