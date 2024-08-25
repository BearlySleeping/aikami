class_name Level extends Node2D

func _free_level() -> void:
	PlayerManager.unparent_player(self)
	queue_free()

func _ready() -> void:
	self.y_sort_enabled = true
	PlayerManager.set_as_parent(self)
	SceneManager.scene_load_started.connect(_free_level)
