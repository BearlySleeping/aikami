class_name PlayerState extends Node

## Stores a reference to the player that this State belongs to
static var player: Player
static var state_machine: PlayerStateMachine


func _ready() -> void:
	pass  # Replace with function body.


## What happens when we initialize this state?
func init() -> void:
	pass


## What happens when the player enters this PlayerState?
func enter() -> void:
	pass


## What happens when the player exits this PlayerState?
func exit() -> void:
	pass


## What happens during the _process update in this PlayerState?
func process(_delta: float) -> PlayerState:
	return null


## What happens during the _physics_process update in this PlayerState?
func physics(_delta: float) -> PlayerState:
	return null


## What happens with input events in this PlayerState?
func handle_input(_event: InputEvent) -> PlayerState:
	return null
