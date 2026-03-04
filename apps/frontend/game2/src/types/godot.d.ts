declare module 'godot' {
    export const _: {
        print(...args: unknown[]): void;
        printerr(...args: unknown[]): void;
        randf(): number;
        randi(): number;
        randfn(mean: number, deviation: number): number;
        rand_range(from: number, to: number): number;
        deg_to_rad(deg: number): number;
        rad_to_deg(rad: number): number;
        lerp(from: number, to: number, weight: number): number;
        clamp(value: number, min: number, max: number): number;
        snapped(value: number, step: number): number;
    };

    export class GodotObject {
        get_class(): string;
        get_type(): string;
        is_instance_valid(): boolean;
        get_instance_id(): number;
        call(method: string, ...args: unknown[]): unknown;
        call_deferred(method: string, ...args: unknown[]): void;
        has_method(method: string): boolean;
        connect(signal: string, callable: Callable, flags?: number): number;
        disconnect(signal: string, callable: Callable): void;
        is_connected(signal: string, callable: Callable): boolean;
        emit_signal(signal: string, ...args: unknown[]): void;
        free(): void;
    }

    export class Node extends GodotObject {
        name: string;
        owner: Node | null;
        parent: Node | null;
        position: Vector2;
        global_position: Vector2;
        rotation: number;
        scale: Vector2;
        z_index: number;
        visible: boolean;

        _ready?(): void;
        _process?(delta: number): void;
        _physics_process?(delta: number): void;
        _enter_tree?(): void;
        _exit_tree?(): void;
        _input?(event: InputEvent): void;

        add_child(node: Node): void;
        remove_child(node: Node): void;
        get_child_count(): number;
        get_children(): Node[];
        get_child(index: number): Node;
        find_child(name: string, recursive?: boolean): Node | null;
        get_parent(): Node | null;
        get_tree(): SceneTree;
        get_world_2d(): World2D;
        is_inside_tree(): boolean;
        is_processing(): boolean;
        add_to_group(group: string): void;
        remove_from_group(group: string): void;
        is_in_group(group: string): boolean;
        get_path(): NodePath;
        has_node(path: string): boolean;
        get_node(path: string): Node | null;
        get_node_or_null(path: string): Node | null;
    }

    export class Node2D extends Node {
        global_position: Vector2;
        position: Vector2;
        rotation: number;
        rotation_degrees: number;
        scale: Vector2;
        offset: Vector2;
        visible: boolean;
        modulate: Color;
        self_modulate: Color;

        _draw?(): void;

        translate(offset: Vector2): void;
        rotate(angle: number): void;
        move_and_collide(velocity: Vector2): KinematicCollision2D | null;
        move_and_slide(): void;
        is_on_floor(): boolean;
        is_on_ceiling(): boolean;
        is_on_wall(): boolean;
        get_wall_normal(): Vector2;
        get_global_mouse_position(): Vector2;
        get_local_mouse_position(): Vector2;
        draw_line(from: Vector2, to: Vector2, color: Color, width?: number): void;
        draw_circle(center: Vector2, radius: number, color: Color): void;
        queue_redraw(): void;
    }

    export class CharacterBody2D extends Node2D {
        velocity: Vector2;

        move_and_slide(): void;
        is_on_floor(): boolean;
        is_on_ceiling(): boolean;
        is_on_wall(): boolean;
        get_wall_normal(): Vector2;
        set_velocity(velocity: Vector2): void;
    }

    export class Area2D extends Node2D {
        monitoring: boolean;
        monitorable: boolean;
        priority: number;
        gravity: number;

        get_overlapping_areas(): Area2D[];
        get_overlapping_bodies(): Node2D[];
        overlaps_node(node: Node): boolean;
    }

    export class Control extends CanvasItem {
        size: Vector2;
        focus_mode: number;

        grab_focus(): void;
        has_focus(): boolean;
        release_focus(): void;
        get_minimum_size(): Vector2;
        get_rect(): Rect2;
        set_size(size: Vector2): void;
    }

    export class CanvasItem extends Node {
        visible: boolean;
        modulate: Color;
        z_index: number;

        hide(): void;
        show(): void;
        queue_redraw(): void;
        is_visible_in_tree(): boolean;
    }

    export class SceneTree extends Node {
        current_scene: Node | null;
        paused: boolean;
        root: Window | null;

        quit(exit_code?: number): void;
        create_timer(time: number): Timer;
        get_root(): Window | null;
        get_current_scene(): Node | null;
    }

    export class Callable {
        static create(object: GodotObject, method: string): Callable;
        call(...args: unknown[]): unknown;
        is_valid(): boolean;
        get_object(): GodotObject | null;
        get_method(): string;
    }

    export class Signal {
        static create(object: GodotObject, signal_name: string): Signal;
        connect(callable: Callable, flags?: number): number;
        disconnect(callable: Callable): void;
        is_connected(callable: Callable): boolean;
        emit(...args: unknown[]): void;
        as_promise(): Promise<unknown[]>;
    }

    export class GDictionary extends GodotObject {
        static create(from: Record<string, unknown>): GDictionary;
        has(key: unknown): boolean;
        size(): number;
        is_empty(): boolean;
        clear(): void;
        get(key: unknown): unknown;
        set(key: unknown, value: unknown): void;
    }

    export class GArray extends GodotObject {
        static create(from: unknown[]): GArray;
        push_back(value: unknown): void;
        pop_back(): unknown;
        has(value: unknown): boolean;
        size(): number;
        is_empty(): boolean;
    }

    export class Vector2 {
        static readonly ZERO: Vector2;
        static readonly ONE: Vector2;
        static readonly UP: Vector2;
        static readonly DOWN: Vector2;
        static readonly LEFT: Vector2;
        static readonly RIGHT: Vector2;

        x: number;
        y: number;

        add(other: Vector2): Vector2;
        subtract(other: Vector2): Vector2;
        multiply(scalar: number): Vector2;
        dot(other: Vector2): number;
        length(): number;
        normalized(): Vector2;
        distance_to(other: Vector2): number;
        lerp(other: Vector2, weight: number): Vector2;
        direction_to(other: Vector2): Vector2;
        angle(): number;
        rotated(angle: number): Vector2;
        is_zero(): boolean;
    }

    export class Vector2i {
        static readonly ZERO: Vector2i;
        static readonly ONE: Vector2i;

        x: number;
        y: number;
    }

    export class Rect2 {
        position: Vector2;
        size: Vector2;

        has_point(point: Vector2): boolean;
        get_area(): number;
    }

    export class Color {
        static readonly BLACK: Color;
        static readonly WHITE: Color;

        r: number;
        g: number;
        b: number;
        a: number;
    }

    export class Input {
        static get_vector(negative_x: string, positive_x: string, negative_y: string, positive_y: string): Vector2;
        static is_action_pressed(action: string): boolean;
        static is_action_just_pressed(action: string): boolean;
        static is_action_just_released(action: string): boolean;
        static get_action_strength(action: string): number;
        static get_axis(negative_action: string, positive_action: string): number;
        static is_mouse_button_pressed(button: number): boolean;
        static is_key_pressed(key: number): boolean;
    }

    export class InputEvent {
        device: number;
    }

    export class InputEventKey extends InputEvent {
        pressed: boolean;
        keycode: number;
    }

    export class InputEventMouseButton extends InputEvent {
        button_index: number;
        position: Vector2;
        pressed: boolean;
    }

    export class InputEventMouseMotion extends InputEventMouseButton {
        relative: Vector2;
    }

    export enum MouseButton {
        LEFT = 1,
        RIGHT = 2,
        MIDDLE = 3,
    }

    export class NodePath {
        is_absolute(): boolean;
        get_name_count(): number;
        is_empty(): boolean;
    }

    export class Resource extends Node {
        resource_path: string;
        get_path(): string;
    }

    export class Texture2D extends Resource {
        get_width(): number;
        get_height(): number;
    }

    export class Font extends Resource {}

    export class Timer extends Node {
        wait_time: number;
        one_shot: boolean;
        autostart: boolean;
        paused: boolean;

        start(time?: number): void;
        stop(): void;
        is_stopped(): boolean;
    }

    export class Window extends CanvasItem {
        size: Vector2;
        title: string;

        close(): void;
        grab_focus(): void;
    }

    export class World2D extends Resource {
        canvas: number;
    }

    export class KinematicCollision2D {
        collider: GodotObject;
        normal: Vector2;
        position: Vector2;
    }

    export class RID {
        get_id(): number;
        is_valid(): boolean;
    }
}
