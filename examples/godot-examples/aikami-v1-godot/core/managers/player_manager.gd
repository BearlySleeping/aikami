extends Node

signal interact_pressed

const PLAYER = preload("res://world/entities/player/player.tscn")

var player: Player
var player_spawned: bool = false

var player_data: PlayerDynamicModel

# Key is Enum.EquippedSlotType and the value is item id
# Example:
# Enum.EquippedSlotType.HEAD: "armor_chestplate_silver"
var player_equipment := {}


func get_current_player() -> PlayerModel:
	return SaveManager.current_player


func get_current_player_dynamic_data() -> PlayerDynamicModel:
	if not player_data:
		player_data = PlayerDynamicModel.new({})
	return player_data


func set_equipments(equipments: Dictionary) -> void:
	# Clear the current equipment
	player_equipment.clear()
	for key: Enum.EquippedSlotType in equipments.keys():
		player_equipment[key] = equipments[key]

	Logger.debug("PlayerManager:set_equipments", player_equipment)


func add_player_instance() -> void:
	if player:
		return
	player = PLAYER.instantiate()
	player_spawned = true
	add_child(player)


func set_health(hp: int, max_hp: int) -> void:
	player.max_hp = max_hp
	player.hp = hp
	player.update_hp(0)


func set_player_position(new_pos: Vector2) -> void:
	add_player_instance()
	player.global_position = new_pos


func set_as_parent(_p: Node2D) -> void:
	if player.get_parent():
		player.get_parent().remove_child(player)
	_p.add_child(player)


func unparent_player(_p: Node2D) -> void:
	_p.remove_child(player)


func play_audio(_audio: AudioStream) -> void:
	player.audio.stream = _audio
	player.audio.play()
