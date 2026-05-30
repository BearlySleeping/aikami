declare module 'godot' {
  export class Callable<T extends Function = Function> {
    static create<T extends object, F extends (this: T, ...args: any[]) => any>(
      self: T,
      fn: F,
    ): Callable<F>;
  }

  export class Node {
    get_node(path: string): unknown;
    add_child(child: Node): void;
    queue_free(): void;
    hide(): void;
    visible: boolean;
    set_process_input(enabled: boolean): void;
    get_tree(): {
      change_scene_to_file(path: string): void;
      quit(exit_code?: number): void;
      paused: boolean;
    };
    get_viewport(): {
      set_input_as_handled(): void;
    };
  }

  export class Color {
    constructor(r: number, g: number, b: number, a?: number);
  }

  export class CanvasItem extends Node {
    modulate: Color;
  }

  export class Control extends CanvasItem {
    grab_focus(): void;
  }

  export class CanvasLayer extends Node {}

  export class Button extends Control {
    pressed: {
      connect(callable: Callable, flags?: number): void;
      connect(callback: () => void): void;
    };
    text: string;
    disabled: boolean;
  }

  export class Label extends CanvasItem {
    text: string;
  }

  export class TabContainer extends Control {
    current_tab: number;
    get_tab_bar(): Control;
  }

  export class TabBar extends Control {}

  export class CheckBox extends Control {
    button_pressed: boolean;
    toggled: { connect(callback: (toggled: boolean) => void): void };
  }

  export class OptionButton extends Control {
    selected: number;
    add_item(text: string): void;
    item_selected: { connect(callback: (index: number) => void): void };
  }

  export class HSlider extends Control {
    value: number;
    value_changed: {
      connect(callable: Callable, flags?: number): void;
      connect(callback: (value: number) => void): void;
    };
  }

  export class LineEdit extends Control {
    text: string;
  }

  export class ResourceLoader {
    static load<T>(path: string): { instantiate(): Node };
  }

  export class PackedScene extends Node {}

  export class FileAccess {
    static open(path: string, mode: number): FileAccess | null;
    static file_exists(path: string): boolean;
    static READ: number;
    static WRITE: number;
    get_line(): string;
    get_as_text(): string;
    put_line(text: string): void;
    store_string(text: string): boolean;
    close(): void;
    eof_reached(): boolean;
    get_length(): number;
  }

  export class HTTPRequest extends Node {
    request(url: string, headers: string[], method: number, body: string): number;
    request_completed: {
      connect(callable: Callable, flags?: number): void;
    };
  }

  export class AudioServer {
    static get_bus_index(name: string): number;
    static set_bus_volume_db(bus: number, volume: number): void;
  }

  export class AudioStreamPlayer extends Node {}

  export class Input {
    static is_action_pressed(action: string): boolean;
    static is_action_released(action: string): boolean;
  }

  export class InputEventKey {
    pressed: boolean;
    keycode: number;
  }

  export type InputEvent = unknown;

  export class OS {
    static delay_msec(msec: number): void;
    static shell_open(url: string): void;
  }
}
