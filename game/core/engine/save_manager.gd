extends Node
## Manager to save data, like player stats and avatar. For more simple config use ConfigManager
const PLAYER_SAVE_PATH := "player/player.save"
const GAME_SAVE_PATH := "game.save"
var current_player: PlayerModel
var current_save_data: GameSaveData
var save_base_path := Global.get_save_path("save")

signal game_loaded
signal game_saved


func _get_path(path: String) -> String:
	return save_base_path + "/" + path


func reset() -> void:
	OS.move_to_trash(ProjectSettings.globalize_path(save_base_path))
	current_save_data = null
	current_player = null


# Save the game data to a file
func save_file(path: String, data: BaseModel) -> bool:
	return save_file_raw(path, data.to_dict())


func save_file_raw(path: String, data: Variant) -> bool:
	var absolute_path := _get_path(path)
	var dir_path := absolute_path.get_base_dir()

	# Ensure the directory exists
	var error := DirAccess.make_dir_recursive_absolute(dir_path)
	if error != OK:
		push_error("Could not create directory: %s" % dir_path)
		return false

	# Proceed with saving the file
	var file := FileAccess.open(absolute_path, FileAccess.WRITE)
	if not file:
		push_error("Could not save to %s" % absolute_path)
		return false
	file.store_var(data)
	file.close()
	return true


# Load the game data from a file
func load_file(path: String) -> Array:
	var file := FileAccess.open(_get_path(path), FileAccess.READ)
	if !file:
		return [null, "Could not load file"]
	var data: Variant = file.get_var()
	file.close()
	return [data, null]


func remove_file(path: String) -> void:
	var dir := DirAccess.open(_get_path(path))
	if dir.file_exists(path):
		var error := dir.remove(path)
		if error == OK:
			Logger.info("File removed successfully.")
		else:
			Logger.info("Failed to remove file.")
	else:
		Logger.info("File does not exist.")


func load_items(
	save_path: String, default_items: Array[InventoryItemModel] = []
) -> Array[InventoryItemModel]:
	var response := load_file(save_path)
	if response[0] == null:
		return default_items
	var data := response[0] as Array
	var items: Array[InventoryItemModel] = []
	for item: Dictionary in data:
		items.append(InventoryItemModel.new(item))
	return items


func save_player_data(player: PlayerModel) -> bool:
	current_player = player
	return save_file(PLAYER_SAVE_PATH, player)


func load_player_data() -> bool:
	var response := load_file(PLAYER_SAVE_PATH)
	if response[0]:
		current_player = PlayerModel.new(response[0])
		return true

	return false


func save_game_data(game_save_data: GameSaveData) -> bool:
	current_save_data = game_save_data
	return save_file(GAME_SAVE_PATH, game_save_data)


func save_game() -> void:
	update_player_data()
	update_scene_path()
	update_item_data()
	save_game_data(current_save_data)
	game_saved.emit()
	pass


func load_game() -> void:
	load_game_data()

	SceneManager.load_new_scene(current_save_data.scene_path, "", Vector2.ZERO)

	await SceneManager.scene_load_started

	PlayerManager.set_player_position(Vector2(current_save_data.player.pos_x, current_save_data.player.pos_y))
	PlayerManager.set_health(current_save_data.player.hp, current_save_data.player.max_hp)
	PlayerManager.INVENTORY_DATA.parse_save_data(current_save_data.items)

	await SceneManager.level_loaded

	game_loaded.emit()


func load_game_data() -> bool:
	if current_save_data:
		return true
	var response := load_file(GAME_SAVE_PATH)
	if response[0]:
		current_save_data = GameSaveData.new(response[0])
		return true
	return false


func get_save_data() -> GameSaveData:
	if current_save_data:
		return current_save_data
	current_save_data = GameSaveData.new({})
	return current_save_data


func initialize() -> bool:
	return load_player_data()


func update_player_data() -> void:
	var current_player := PlayerManager.player
	var player_data := current_save_data.player
	player_data.hp = current_player.hp
	player_data.max_hp = current_player.max_hp
	player_data.pos_x = current_player.global_position.x
	player_data.pos_y = current_player.global_position.y
	current_save_data.player = player_data


func update_scene_path() -> void:
	var scene_path := ""
	for c in get_tree().root.get_children():
		if c is Level:
			scene_path = c.scene_file_path
	if scene_path == "":
		return
	current_save_data.scene_path = scene_path


func update_item_data() -> void:
	current_save_data.items = PlayerManager.INVENTORY_DATA.get_save_data()


func add_persistent_value(value: String) -> void:
	if check_persistent_value(value) == false:
		current_save_data.persistence.append(value)
	pass


func check_persistent_value(value: String) -> bool:
	var p := current_save_data.persistence
	return p.has(value)
