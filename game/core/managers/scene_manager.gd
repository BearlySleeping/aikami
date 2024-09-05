extends Node
## SceneManager
##
## Manages scene transitions within the game, including loading new scenes with various transitions,
## handling asynchronous loading with progress feedback,
## and emitting signals about the loading status.
## Utilizes Godot's ResourceLoader for efficient background loading of scenes to
## improve user experience
## during transitions.
signal scene_load_started
signal scene_loaded
signal tilemap_bounds_changed( bounds : Array[ Vector2 ] )

enum SceneName {
	MAIN,
	MAIN_MENU,
	CHARACTER_CREATION,
}

var current_tilemap_bounds : Array[ Vector2 ]
var target_transition : String
var position_offset : Vector2


func _ready() -> void:
	await get_tree().process_frame
	scene_loaded.emit()

func change_tilemap_bounds( bounds : Array[ Vector2 ] ) -> void:
	current_tilemap_bounds = bounds
	tilemap_bounds_changed.emit( bounds )

func load_new_scene(
		scene_path: String,
		_target_transition : String = "",
		_position_offset : Vector2 = Vector2.ZERO
) -> void:
	get_tree().paused = true
	target_transition = _target_transition
	position_offset = _position_offset

	await SceneTransition.fade_out()

	scene_load_started.emit()

	await get_tree().process_frame
	# var scene_path := _to_scene_path(scene_name)
	get_tree().change_scene_to_file( scene_path )

	await SceneTransition.fade_in()

	get_tree().paused = false

	await get_tree().process_frame

	scene_loaded.emit()

func load_new_fixed_scene(
		scene_name: SceneName,
		_target_transition : String = "",
		_position_offset : Vector2 = Vector2.ZERO
) -> void:
	var scene_path := _to_scene_path(scene_name)
	load_new_scene(scene_path, _target_transition, _position_offset)




func _to_scene_path(scene_name: SceneName) -> String:
	match scene_name:
		SceneName.MAIN:
			return "res://world/maps/main.tscn"
		SceneName.CHARACTER_CREATION:
			return "res://interface/menus/main/character_creation/character_creation.tscn"
		SceneName.MAIN_MENU:
			return "res://interface/menus/main/main_menu.tscn"
		_:
			push_error("Invalid scene_name")
			return ""
