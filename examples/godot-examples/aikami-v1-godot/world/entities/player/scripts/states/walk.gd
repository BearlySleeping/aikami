extends PlayerState

@export var move_speed: float = 100.0

@onready var idle: PlayerState = $"../Idle"
@onready var attack: PlayerState = $"../Attack"


## What happens when the player enters this PlayerState?
func enter() -> void:
	player.update_animation("walk")


## What happens when the player exits this PlayerState?
func exit() -> void:
	pass


## What happens during the _process update in this PlayerState?
func process(_delta: float) -> PlayerState:
	if player.direction == Vector2.ZERO:
		return idle

	player.velocity = player.direction * move_speed

	if player.set_direction():
		player.update_animation("walk")
	return null


## What happens during the _physics_process update in this PlayerState?
func physics(_delta: float) -> PlayerState:
	return null


## What happens with input events in this PlayerState?
func handle_input(_event: InputEvent) -> PlayerState:
	if _event.is_action_pressed("attack"):
		return attack
	if _event.is_action_pressed("interact"):
		PlayerManager.interact_pressed.emit()
	return null
