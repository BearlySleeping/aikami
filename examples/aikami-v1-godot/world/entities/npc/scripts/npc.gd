@tool
@icon("res://world/entities/npc/icons/npc.svg")
class_name NPC extends CharacterBody2D

signal do_behavior_enabled

@export var npc_id: NPCManager.PredefinedNPC:
	set(value):
		if npc_id == value:
			return
		npc_id = value
		update_sprite(value)

var state: String = "idle"
var direction: Vector2 = Vector2.DOWN
var direction_name: String = "down"
var do_behavior: bool = true

@onready var animation: AnimationPlayer = $AnimationPlayer

@onready var sprite_2d: Sprite2D = $Sprite2D


func update_sprite(id: NPCManager.PredefinedNPC) -> void:
	var npc_data := NPCManager.get_npc(id)
	if not npc_data:
		return push_error("NPC data not found for npc_id: ", id)
	var animation_sprite_sheet_path := npc_data.animation_sprite_sheet_path
	await ready
	sprite_2d.texture = load(animation_sprite_sheet_path)


func _ready() -> void:
	setup_npc()
	if Engine.is_editor_hint():
		return
	do_behavior_enabled.emit()


func _physics_process(_delta: float) -> void:
	move_and_slide()


func update_animation() -> void:
	animation.play(state + "_" + direction_name)


func update_direction(target_position: Vector2) -> void:
	direction = global_position.direction_to(target_position)
	update_direction_name()
	if direction_name == "side" and direction.x < 0:
		sprite_2d.flip_h = true
	else:
		sprite_2d.flip_h = false


func update_direction_name() -> void:
	var threshold: float = 0.45
	if direction.y < -threshold:
		direction_name = "up"
	elif direction.y > threshold:
		direction_name = "down"
	elif direction.x > threshold || direction.x < -threshold:
		direction_name = "side"


func setup_npc() -> void:
	if npc_id == null or npc_id == NPCManager.PredefinedNPC.NONE:
		return
	update_sprite(npc_id)
