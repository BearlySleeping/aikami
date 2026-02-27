// .ai/reference.ts
import { Button, Callable, GError, Node, ResourceLoader, Signal1, Variant } from 'godot';
import { Export, ExportEnum, ExportFlags, OnReady, Signal, Tool } from 'godot.annotations';
import { JSWorker } from 'godot.worker';

/**
 * Standard enum for Color selection.
 * @readonly
 */
enum MyColor {
  White,
  Red,
  Blue,
}

/**
 * Bit-flag enum for tagging entities.
 * @readonly
 */
enum MyTags {
  None = 0,
  Cold = 1,
  Hot = 2,
}

/**
 * ReferenceNode serves as the "Golden Sample" for GodotJS syntax.
 * It demonstrates best practices for Exports, Signals, Threading, and Web compatibility.
 * * @example
 * // Instantiate in code
 * const node = new ReferenceNode();
 * this.add_child(node);
 */
@Tool() // Runs in editor
export default class ReferenceNode extends Button {
  // --- EXPORTS ---

  /**
   * Movement speed in pixels per second.
   * Exported as a float to the Godot Inspector.
   * @default 100
   */
  @Export(Variant.Type.TYPE_INT)
  speed: number = 100;

  /**
   * The primary color of the entity.
   * Uses a dropdown in the Inspector.
   */
  @ExportEnum(MyColor)
  color: MyColor = MyColor.White;

  /**
   * Tags associated with this entity.
   * Allows multiple selections in the Inspector.
   */
  @ExportFlags(MyTags)
  tags: MyTags = MyTags.None;

  // --- SIGNALS ---

  /**
   * Emitted when the health value changes.
   * @param newHealth The updated health value.
   */
  @Signal()
  healthChanged!: Signal1<number>;

  // --- ONREADY ---

  /**
   * Reference to a child node named "ChildLabel".
   * Validated at _ready().
   */
  @OnReady('ChildLabel')
  label!: Node;

  /**
   * Reference to a child node named "ChildButton".
   * Validated at _ready().
   */
  @OnReady('ChildButton')
  btn!: Button;

  // --- LIFECYCLE ---

  /**
   * Called when the node enters the scene tree for the first time.
   * Initializes signals and starts worker threads.
   */
  _ready() {
    // 1. SIGNAL CONNECTION (Code-First)
    // PREFER this over Editor GUI connections.
    // Use `Callable.create(scope, function)`
    this.btn.pressed.connect(
      Callable.create(this, this.onButtonPressed),
      0, // Flags (optional)
    );
    // 2. AWAITING SIGNALS
    this.testAsyncLogic();

    // 3. THREADED LOADING (Safe pattern)
    this._loadResourceBackground('res://assets/art/logo.png');

    // 4. WORKERS
    this._setupWorker();
  }

  // --- EVENT HANDLERS ---

  /**
   * Handles the button press event.
   * MUST be public for Godot to call it via string name lookup.
   */
  public onButtonPressed() {
    console.log('Button pressed!');
    this.healthChanged.emit(50);
  }

  // --- ASYNC LOGIC ---

  /**
   * Demonstrates how to await a Godot signal in TypeScript.
   * This pauses execution until the signal is emitted.
   */
  private async testAsyncLogic() {
    console.log('Waiting for signal...');
    // Await a signal as a promise
    await this.healthChanged.as_promise();
    console.log('Signal received!');
  }

  // --- WORKER THREADS ---

  /**
   * Initializes a background worker for database or heavy logic.
   * Essential for SQLite operations on the Web export.
   */
  private _setupWorker() {
    // Workers run in a separate thread (essential for Web/SQLite)
    const worker = new JSWorker('src/data/sqlite.worker');

    worker.onmessage = (msg: any) => {
      console.log('Main thread received:', msg);
      worker.terminate();
    };

    worker.postMessage({ query: 'SELECT * FROM items' });
  }

  // --- ADVANCED API USAGE ---

  /**
   * Loads a resource in the background to avoid freezing the main thread.
   * @param path - The resource path (e.g., "res://...")
   */
  private _loadResourceBackground(path: string) {
    // Request load
    const err = ResourceLoader.load_threaded_request(path);
    if (err !== GError.OK) {
      console.error('Load failed:', GError[err]);
      return;
    }

    // Poll for completion (simplified)
    // In real code, use a SceneTreeTimer or _process check
    const check = setInterval(() => {
      const status = ResourceLoader.load_threaded_get_status(path);
      if (status === ResourceLoader.ThreadLoadStatus.THREAD_LOAD_LOADED) {
        const res = ResourceLoader.load_threaded_get(path);
        console.log('Loaded resource:', res);
        clearInterval(check);
      }
    }, 100);
  }
}
