class_name Player2
extends CharacterBody2D

signal request_path_to_target(
	current_position: Vector2i, target_position: Vector2i, path: PackedVector2Array
)

enum Direction { LEFT, RIGHT, DOWN, UP }

@export var speed := 100

var target_index := 0
var current_direction := Direction.DOWN
var input_enabled := true
## A path determined by mouse input for guiding the player's movement.
var mouse_path: PackedVector2Array = []
@onready var animated_sprite_2d: AnimatedSprite2D = $AnimatedSprite2D


func disable() -> void:
	input_enabled = false
	velocity = Vector2.ZERO
	_handle_animation()


func enable() -> void:
	input_enabled = true


func _physics_process(_delta: float) -> void:
	if Global.dialogue_active:
		if input_enabled:
			disable()
		return
	if !input_enabled:
		enable()

	_handle_movement()
	_handle_animation()


func _unhandled_input(event: InputEvent) -> void:
	if not event.is_action_pressed("move_click"):
		return
	Logger.debug("_unhandled_input:move_click", event)
	var click_position := get_global_mouse_position()
	request_path_to_target.emit(global_position, click_position, mouse_path)


func _handle_movement() -> void:
	var move_direction := _get_move_direction()

	velocity = move_direction.normalized() * speed

	if velocity.is_zero_approx():
		return
	velocity = move_direction.normalized() * speed

	move_and_slide()

	current_direction = _get_direction(move_direction)

	if mouse_path.is_empty():
		return

	var threshold := 10.0
	var target_position := mouse_path[0]
	if global_position.distance_to(target_position) < threshold:
		mouse_path.remove_at(0)


func _get_move_direction() -> Vector2:
	var input_direction := Input.get_vector("move_left", "move_right", "move_up", "move_down")

	if not input_direction.is_zero_approx():
		mouse_path.clear()  # Clear the path if there's direct input, prioritizing manual control.
		return input_direction

	if mouse_path.is_empty():
		return Vector2.ZERO

	var target_position := mouse_path[0]
	var direction_to_target := target_position - global_position

	return direction_to_target


func _handle_animation() -> void:
	animated_sprite_2d.flip_h = current_direction == Direction.LEFT
	var animation_name := _get_animation_name()
	animated_sprite_2d.play(animation_name)


func _get_animation_name() -> StringName:
	var is_moving := velocity.length() > 0
	match current_direction:
		Direction.DOWN:
			return &"walk_back" if is_moving else &"idle_back"
		Direction.UP:
			return &"walk_front" if is_moving else &"idle_front"
		_:
			return &"walk_side" if is_moving else &"idle_side"


func _get_direction(direction: Vector2) -> Direction:
	if direction.y:
		return Direction.UP if direction.y > 0 else Direction.DOWN
	return Direction.RIGHT if direction.x > 0 else Direction.LEFT
