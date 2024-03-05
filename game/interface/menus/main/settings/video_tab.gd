extends TabBar

@onready var fullscreen: CheckBox = $HBoxContainer/VBoxContainer2/Fullscreen
@onready var borderless: CheckBox = $HBoxContainer/VBoxContainer2/Borderless
@onready var vsync: OptionButton = $HBoxContainer/VBoxContainer2/Vsync


func _ready() -> void:
	load_video_settings()


func load_video_settings() -> void:
	var is_fullscreen: bool = ConfigManager.get_value(
		ConfigManager.ConfigKey.VIDEO_FULLSCREEN, false
	)
	if is_fullscreen:
		fullscreen.button_pressed = true
	var is_borderless: bool = ConfigManager.get_value(
		ConfigManager.ConfigKey.VIDEO_BORDERLESS, false
	)
	if is_borderless == true:
		borderless.button_pressed = true
	var vsync_index: int = ConfigManager.get_value(ConfigManager.ConfigKey.VIDEO_VSYNC, 0)
	vsync.selected = vsync_index


func _on_fullscreen_toggled(toggled_on: bool) -> void:
	DisplayServer.window_set_mode(
		DisplayServer.WINDOW_MODE_FULLSCREEN if toggled_on else DisplayServer.WINDOW_MODE_WINDOWED
	)
	ConfigManager.set_value(ConfigManager.ConfigKey.VIDEO_FULLSCREEN, toggled_on)
	_play_button_sound()


func _on_borderless_toggled(toggled_on: bool) -> void:
	DisplayServer.window_set_flag(DisplayServer.WINDOW_FLAG_BORDERLESS, toggled_on)
	ConfigManager.set_value(ConfigManager.ConfigKey.VIDEO_BORDERLESS, toggled_on)
	_play_button_sound()


func _on_vsync_item_selected(index: int) -> void:
	DisplayServer.window_set_vsync_mode(index)
	ConfigManager.set_value(ConfigManager.ConfigKey.VIDEO_VSYNC, index)
	_play_button_sound()


func _play_button_sound() -> void:
	AudioManager.play_sfx(AudioManager.SFXName.MENU)
