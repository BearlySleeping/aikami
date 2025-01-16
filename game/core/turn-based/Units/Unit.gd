@tool
extends Node2D
class_name Unit

signal turn_started(unit: Unit)

@export var unit_type := Enum.UnitType.PARTY
@export var unit_id := NPCManager.PredefinedNPC.NONE:
	set(value):
		if unit_id == value:
			return
		unit_id = value
		update_data(value)

var label := "Default Unit"
var max_health := 100
var mana := 50
var attack := 10
var defense := 5
var is_enemy: bool = false

@onready var pointer_sprite: Sprite2D = $PointerSprite
@onready var avatar_sprite: Sprite2D = $AvatarSprite
@onready var health_progress_bar: ProgressBar = $HealthProgressBar
@onready var animation_player: AnimationPlayer = $AnimationPlayer

var health: float = 7:
	set(value):
		health = value
		_update_health_progress_bar()
		_play_animation()


func update_data(p_unit_id: NPCManager.PredefinedNPC) -> void:
	if p_unit_id == NPCManager.PredefinedNPC.NONE:
		return set_player_data()
	var npc_data := NPCManager.get_npc(p_unit_id)
	if not npc_data:
		return push_error("NPC data not found for npc_id: ", p_unit_id)
	var npc_dynamic_data := NPCManager.get_dynamic_npc_data(p_unit_id)
	label = npc_data.name
	max_health = npc_dynamic_data.health
	mana = npc_dynamic_data.mana
	attack = npc_dynamic_data.attack
	defense = npc_dynamic_data.defense
	update_sprite(npc_data.unit_sprite_path)


func set_player_data() -> void:
	var player_data := PlayerManager.get_current_player()
	var player_dynamic_data := PlayerManager.get_current_player_dynamic_data()
	label = player_data.name
	max_health = player_dynamic_data.health
	mana = player_dynamic_data.mana
	attack = player_dynamic_data.attack
	defense = player_dynamic_data.defense
	update_sprite(player_data.unit_sprite_path)


func update_sprite(sprite_path: String) -> void:
	await ready
	avatar_sprite.flip_h = unit_type == Enum.UnitType.ENEMY
	avatar_sprite.texture = load(sprite_path)


func _update_health_progress_bar() -> void:
	health_progress_bar.value = (health / max_health) * 100


func _play_animation() -> void:
	animation_player.play("hurt")


func focus() -> void:
	pointer_sprite.show()


func unfocus() -> void:
	pointer_sprite.hide()


func take_damage(value: int) -> void:
	health -= value


func start_turn() -> void:
	turn_started.emit()
