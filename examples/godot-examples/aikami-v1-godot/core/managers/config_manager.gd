class_name ConfigManager
## Manager to save user configuration. For more advanced saving use SaveManager

enum ConfigKey {
	# API
	API_OPEN_AI_KEY,
	API_HUGGING_FACE_KEY,
	API_ELEVEN_LABS_KEY,
	API_IMAGE_PROVIDER,
	API_TEXT_PROVIDER,
	API_TEXT_TO_SPEECH_PROVIDER,
	API_SPEECH_TO_TEXT_PROVIDER,
	API_TEXT_TO_SPEECH_ENABLED,
	# Audio
	AUDIO_MASTER_VOLUME,
	AUDIO_SFX_VOLUME,
	AUDIO_MUSIC_VOLUME,
	AUDIO_VOICE_VOLUME,
	# Video
	VIDEO_FULLSCREEN,
	VIDEO_VSYNC,
	VIDEO_BORDERLESS,
	# Controls
	CONTROLS_MOVE_LEFT,
	CONTROLS_MOVE_RIGHT,
	CONTROLS_MOVE_UP,
	CONTROLS_MOVE_DOWN,
	CONTROLS_TALK,
	CONTROLS_MENU,
}

const CONFIG_PATH := "settings.cfg"

# Create new ConfigFile object.
static var config := ConfigFile.new()
static var loaded := false


static func set_value(key: ConfigKey, value: Variant) -> void:
	var key_name := _to_key_name(key)
	config.set_value(_to_section_name(key_name), key_name, value)
	config.save(Global.get_save_path(CONFIG_PATH))


static func get_value(key: ConfigKey, default: Variant = null) -> Variant:
	if !loaded:
		loaded = true
		_load_config()
	var key_name := _to_key_name(key)
	return config.get_value(_to_section_name(key_name), key_name, default)


static func _load_config() -> void:
	config.load(Global.get_save_path(CONFIG_PATH))


static func _to_key_name(key: ConfigKey) -> String:
	return ConfigKey.keys()[key].to_lower()


static func _to_section_name(key_name: String) -> String:
	var section: String = key_name.split("_")[0]
	return section
