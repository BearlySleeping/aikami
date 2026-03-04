---
name: godotjs-scripting
description: Best practices, syntax rules, and examples for writing TypeScript/JavaScript scripts in Godot using the Godot.js framework.
version: 1.0.0
author: OpenCode User
tags: ["godot", "gamedev", "typescript", "javascript", "godotjs"]
---

# Godot.js Scripting Skill

This skill provides the core rules, syntax, and best practices for writing Godot scripts using TypeScript via the **GodotJS** framework. When assisting with Godot.js, ALWAYS adhere to these constraints.

## 1. Class Definition & Lifecycle
- **Default Export Required**: Every script must export a single class as the default export.
- **Inheritance**: Classes must inherit from a Godot native class (e.g., `Node`, `Sprite2D`).
- **Constructors**: Avoid explicit constructors if possible. If you must use one, define it with an explicit identifier and call `super`:
  ```typescript
  import { Node } from "godot";

  export default class MyNode extends Node {
      constructor(identifier?: any) {
          super(identifier);
          // additional setup
      }
      
      _ready() {
          console.log("Ready!");
      }
  }
  ```
- **Async/Await**: You can freely use `async` / `await` inside lifecycle methods (like `async _ready()`).

## 2. Decorators & Annotations

Use decorators imported from `"godot.annotations"` to define metadata.

- **@Export**: Expose variables to the Godot Editor. You MUST explicitly provide the type as the first parameter.
```typescript
import { Variant } from "godot";
import { Export, ExportEnum } from "godot.annotations";

@Export(Variant.Type.TYPE_FLOAT)
speed: number = 10.0;

@ExportEnum(MyColorEnum)
color: MyColorEnum = MyColorEnum.White;
```

- **@Tool**: Run scripts inside the Godot editor.
```typescript
import { Tool } from "godot.annotations";

@Tool()
export default class EditorTool extends Node {}
```

- **@Icon**: Assign a custom icon in the Scene Tree.
```typescript
import { Icon } from "godot.annotations";

@Icon("res://icon.svg")
export default class CustomNode extends Node {}
```

## 3. Signals

Signals require special syntax for declaration, connection, and emission.

- **Declaration**: Use `@ExportSignal` and `declare`.
```typescript
import { Signal } from "godot";
import { ExportSignal } from "godot.annotations";

@ExportSignal()
declare my_signal!: Signal<(param: string) => void>;
```

- **Emitting & Passing Data**: You CANNOT pass raw JS/TS objects through signals. You must wrap them in Godot structures (`GDictionary`, `GArray`).
```typescript
import { GDictionary } from "godot";
// INCORRECT: this.my_signal.emit({ key: "val" })
// CORRECT:
this.my_signal.emit(GDictionary.create({ key: "val" }));
```

- **Connecting Programmatically**: Use `Callable.create()`. **Never** capture `this` inside an arrow function for a Callable as it causes memory leaks.
```typescript
import { Callable } from "godot";

this.get_node("Button").pressed.connect(
    Callable.create(this, this.handle_click), 
    0
);
```

- **Awaiting Signals**: Use `.as_promise()`.
```typescript
const result = await this.my_signal.as_promise();
```

## 4. NPM Dependencies

- GodotJS does not run Node.js natively. Standard Node libraries (like `fs`, `path`) will not work out of the box.
- To use external NPM packages safely, bundle them in a separate file (e.g., `npm.bundle.ts`) and import from that bundle:
```typescript
// npm.bundle.ts
export { default as dayjs } from "dayjs";

// my_script.ts
import { dayjs } from "./npm.bundle";
```

## 5. Anti-Patterns to Avoid

1. ❌ Writing `new Callable(this, () => this.func())` (Causes object leaks).
2. ❌ Omitting `default` from the class export (Godot will not recognize the script).
3. ❌ Defining `@Export` without passing `Variant.Type` (TS static typing is stripped at runtime; GodotJS needs the explicit Variant Type).
4. ❌ Emitting pure JS objects into Godot methods or signals. Always use `GDictionary.create()` or `GArray.create()`.
