extends Node
## SceneManager
##
## Manages scene transitions within the game, including loading new scenes with various transitions,
## handling asynchronous loading with progress feedback,
## and emitting signals about the loading status.
## Utilizes Godot's ResourceLoader for efficient background loading of scenes to
## improve user experience
## during transitions.
signal content_finished_loading(content: Node)
signal zelda_content_finished_loading(content: Node)
signal content_invalid(content_path: String)
signal content_failed_to_load(content_path: String)

enum SceneName {
	MAIN,
	MAIN_MENU,
	CHARACTER_CREATION,
}

var level_h: int = ProjectSettings.get("display/window/size/viewport_height")
var level_w: int = ProjectSettings.get("display/window/size/viewport_width")

var loading_screen: LoadingScreen
var _loading_screen_scene: PackedScene = preload(
	"res://interface/menus/loading/loading_screen.tscn"
)
var _transition: String
var _content_path: String
var _load_progress_timer: Timer


func _ready() -> void:
	content_invalid.connect(_on_content_invalid)
	content_failed_to_load.connect(_on_content_failed_to_load)
	content_finished_loading.connect(_on_content_finished_loading)
	zelda_content_finished_loading.connect(_on_zelda_content_finished_loading)


## Initiates the loading of a new scene with an optional transition effect.
## Parameters:
## - `scene_name` (SceneName): The enum value representing the scene to load.
## - `transition_type` (String): The type of transition to display (default: "fade_to_black").
func load_new_scene(scene_name: SceneName, transition_type: String = "fade_to_black") -> void:
	_transition = transition_type
	# add loading screen
	loading_screen = _loading_screen_scene.instantiate() as LoadingScreen
	get_tree().root.add_child(loading_screen)
	loading_screen.start_transition(transition_type)
	_load_content(scene_name)


## Loads a new scene using a Zelda-style transition.
## Parameters:
## - `scene_name` (SceneName): The enum value representing the scene to load.
func load_level_zelda(scene_name: SceneName) -> void:
	_transition = "zelda"
	_load_content(scene_name)


func _get_scene_path(scene_name: SceneName) -> String:
	match scene_name:
		SceneName.MAIN:
			return "res://maps/main.tscn"
		SceneName.CHARACTER_CREATION:
			return "res://interface/menus/main/character_creation/character_creation.tscn"
		SceneName.MAIN_MENU:
			return "res://interface/menus/main/main_menu.tscn"
		_:
			push_error("Invalid scene_name")
			return ""


func _load_content(scene_name: SceneName) -> void:
	# zelda transition doesn't use a loading screen - personal preference
	if loading_screen:
		await loading_screen.transition_in_complete

	_content_path = _get_scene_path(scene_name)
	var loader := ResourceLoader.load_threaded_request(_content_path)
	if not ResourceLoader.exists(_content_path) or loader == null:
		content_invalid.emit(_content_path)
		return

	_load_progress_timer = Timer.new()
	_load_progress_timer.wait_time = 0.1
	_load_progress_timer.timeout.connect(_monitor_load_status)
	get_tree().root.add_child(_load_progress_timer)
	_load_progress_timer.start()


# checks in on loading status
# and ended up skipping over the loading display.
func _monitor_load_status() -> void:
	var load_progress: Array[int] = []
	var load_status := ResourceLoader.load_threaded_get_status(_content_path, load_progress)

	match load_status:
		ResourceLoader.THREAD_LOAD_INVALID_RESOURCE:
			content_invalid.emit(_content_path)
			_load_progress_timer.stop()
			return
		ResourceLoader.THREAD_LOAD_IN_PROGRESS:
			if loading_screen:
				loading_screen.update_bar(load_progress[0] * 100)  # 0.1
		ResourceLoader.THREAD_LOAD_FAILED:
			content_failed_to_load.emit(_content_path)
			_load_progress_timer.stop()
			return
		ResourceLoader.THREAD_LOAD_LOADED:
			_load_progress_timer.stop()
			_load_progress_timer.queue_free()
			var loaded_resource := ResourceLoader.load_threaded_get(_content_path)
			if !loaded_resource:
				push_error("Failed to load resource")
				return
			var instantiated_resource: Node = loaded_resource.instantiate()
			if !(instantiated_resource is Node):
				return push_error("Loaded resource is not a Node or subtype.")
			if _transition == "zelda":
				zelda_content_finished_loading.emit(instantiated_resource)
			else:
				content_finished_loading.emit(instantiated_resource)


func _on_content_failed_to_load(path: String) -> void:
	printerr("error: Failed to load resource: '%s'" % [path])


func _on_content_invalid(path: String) -> void:
	printerr("error: Cannot load resource: '%s'" % [path])


func _on_content_finished_loading(content: Node) -> void:
	var outgoing_scene := get_tree().current_scene

	# If we're moving between Levels, pass LevelDataHandoff here
	var incoming_data: LevelDataHandoff
	if get_tree().current_scene is Level:
		incoming_data = get_tree().current_scene.data as LevelDataHandoff

	if content is Level:
		content.data = incoming_data

	# Remove the old scene
	outgoing_scene.queue_free()

	# Add and set the new scene to current
	get_tree().root.call_deferred("add_child", content)
	get_tree().set_deferred("current_scene", content)

	# probably not necessary since we split our content_finished_loading
	# but it won't hurt to have an extra check
	if loading_screen:
		loading_screen.finish_transition()
		# e.g. will be skipped if we're loading a menu instead of a game level
		if content is Level:
			content.init_player_location()
		# wait for LoadingScreen's transition to finish playing
		await loading_screen.anim_player.animation_finished
		loading_screen = null
		# samesies^
		if content is Level:
			content.enter_level()


# load in a level, does NOT use the loading screen (which comes with tradeoffs)
func _on_zelda_content_finished_loading(content: Node) -> void:
	var outgoing_scene := get_tree().current_scene
	# If we're moving between Levels, pass LevelDataHandoff here

	var incoming_data: LevelDataHandoff
	if get_tree().current_scene is Level:
		incoming_data = get_tree().current_scene.data as LevelDataHandoff

	if content is Level:
		content.data = incoming_data

	# some might do this with a camera, I did it by moving the content

	# slide new level in
	content.position.x = incoming_data.move_dir.x * level_w
	content.position.y = incoming_data.move_dir.y * level_h
	var tween_in: Tween = get_tree().create_tween()
	tween_in.tween_property(content, "position", Vector2.ZERO, 1).set_trans(Tween.TRANS_SINE)

	# slide old level out
	var tween_out: Tween = get_tree().create_tween()
	var vector_off_screen: Vector2 = Vector2.ZERO
	vector_off_screen.x = -incoming_data.move_dir.x * level_w
	vector_off_screen.y = -incoming_data.move_dir.y * level_h
	tween_out.tween_property(outgoing_scene, "position", vector_off_screen, 1).set_trans(
		Tween.TRANS_SINE
	)

	# add new scene to the tree - (Note: could be loaded into a container instead)
	get_tree().root.call_deferred("add_child", content)

	# once the tweens are done, do some cleanup
	await tween_in.finished

	# skipped if not a Level
	if content is Level:
		content.init_player_location()
		content.enter_level()

	# Remove the old scene
	outgoing_scene.queue_free()
	# Add and set the new scene to current
	# so we can get its data obj next time we move between Levels
	get_tree().current_scene = content
