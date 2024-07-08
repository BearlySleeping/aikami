class_name SaveManager
## Manager to save data, like player stats and avatar. For more simple config use ConfigManager
const PLAYER_SAVE_PATH := "player/player.save"
const GAME_SAVE_PATH := "game.save"
static var current_player: PlayerModel
static var current_game_data: GameSaveData
static var save_base_path := Global.get_save_path("save")


static func _get_path(path: String) -> String:
	return save_base_path + "/" + path


static func reset() -> void:
	OS.move_to_trash(ProjectSettings.globalize_path(save_base_path))
	current_game_data = null
	current_player = null


# Save the game data to a file
static func save_file(path: String, data: BaseModel) -> bool:
	return save_file_raw(path, data.to_dict())


static func save_file_raw(path: String, data: Variant) -> bool:
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
static func load_file(path: String) -> Array:
	var file := FileAccess.open(_get_path(path), FileAccess.READ)
	if !file:
		return [null, "Could not load file"]
	var data: Variant = file.get_var()
	file.close()
	return [data, null]


static func remove_file(path: String) -> void:
	var dir := DirAccess.open(_get_path(path))
	if dir.file_exists(path):
		var error := dir.remove(path)
		if error == OK:
			Logger.info("File removed successfully.")
		else:
			Logger.info("Failed to remove file.")
	else:
		Logger.info("File does not exist.")


static func load_items(
	save_path: String, default_items: Array[InventoryItemModel] = []
) -> Array[InventoryItemModel]:
	var response := SaveManager.load_file(save_path)
	if response[0] == null:
		return default_items
	var data := response[0] as Array
	var items: Array[InventoryItemModel] = []
	for item: Dictionary in data:
		items.append(InventoryItemModel.new(item))
	return items


static func save_player_data(player: PlayerModel) -> bool:
	current_player = player
	return save_file(PLAYER_SAVE_PATH, player)


static func load_player_data() -> bool:
	var response := load_file(PLAYER_SAVE_PATH)
	if response[0]:
		current_player = PlayerModel.new(response[0])
		return true

	return false


static func save_game_data(game_save_data: GameSaveData) -> bool:
	current_game_data = game_save_data
	return save_file(GAME_SAVE_PATH, game_save_data)


static func load_game_data() -> bool:
	if current_game_data:
		return true
	var response := load_file(GAME_SAVE_PATH)
	if response[0]:
		current_game_data = GameSaveData.new(response[0])
		return true
	return false


static func get_save_data() -> GameSaveData:
	if current_game_data:
		return current_game_data
	current_game_data = GameSaveData.new({})
	return current_game_data


static func initialize() -> bool:
	return load_player_data()
