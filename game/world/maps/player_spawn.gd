extends Node2D


func _ready() -> void:
	visible = false
	if PlayerManager.player_spawned:
		return
	PlayerManager.set_player_position( global_position )
	PlayerManager.player_spawned = true
