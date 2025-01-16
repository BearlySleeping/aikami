class_name Global
## Global stats to use across the project
enum ScreenType { MAIN_MENU, PAUSE_MENU, GAME_MENU, GAME }

## If true then the dialog box is active, used to disable processes like user input
static var dialogue_active := false

static var screen_type := ScreenType.MAIN_MENU

# Determine if the game is running from the editor or a "standalone" binary.
static var is_development := OS.has_feature("debug")

## The base path to save all data, generated images, save files and config files.
static var _base_save_path := "res://__debug/" if Global.is_development else "user://"


static func get_save_path(path: String) -> String:
	return _base_save_path + path


## Only use this function when debugging
static func test_set_playground_mode() -> void:
	Hud.visible = false
