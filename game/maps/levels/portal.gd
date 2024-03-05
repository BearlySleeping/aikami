class_name Portal
extends Area2D

signal player_entered_portal(portal: Portal, transition_type: String)

@export_enum("north", "east", "south", "west") var entry_direction: String
@export_enum("fade_to_black", "fade_to_white", "wipe_to_right", "zelda") var transition_type: String
@export var push_distance: int = 16
@export var scene_name: SceneManager.SceneName
@export var entry_door_name: String


# returns the starting location of the player based on this door's location and the
# entry_direction (the Vector towards the room)
func get_player_entry_vector() -> Vector2:
	var vector := Vector2.LEFT
	match entry_direction:
		0:
			vector = Vector2.UP
		1:
			vector = Vector2.RIGHT
		2:
			vector = Vector2.DOWN
	return (vector * push_distance) + self.position


# inverts entry direction to determine the direction player would have been moving
# when they entered the room
func get_move_dir() -> Vector2:
	var dir := Vector2.RIGHT
	match entry_direction:
		0:
			dir = Vector2.DOWN
		1:
			dir = Vector2.LEFT
		2:
			dir = Vector2.UP
	return dir


func _on_body_entered(body: Node2D) -> void:
	if not body is Player:
		return
	player_entered_portal.emit(self)
	if transition_type == "zelda":
		SceneManager.load_level_zelda(scene_name)
	else:
		SceneManager.load_new_scene(scene_name, transition_type)
	queue_free()
