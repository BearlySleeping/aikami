extends TabBar

const BUS_MAP := {
	ConfigManager.ConfigKey.AUDIO_MASTER_VOLUME: "Master",
	ConfigManager.ConfigKey.AUDIO_MUSIC_VOLUME: "Music",
	ConfigManager.ConfigKey.AUDIO_SFX_VOLUME: "SFX",
	ConfigManager.ConfigKey.AUDIO_VOICE_VOLUME: "Voice"
}

@onready var sliders := {
	ConfigManager.ConfigKey.AUDIO_MASTER_VOLUME: %MasterVolumeSlider,
	ConfigManager.ConfigKey.AUDIO_MUSIC_VOLUME: %MusicVolumeSlider,
	ConfigManager.ConfigKey.AUDIO_SFX_VOLUME: %SoundVolumeSlider,
	ConfigManager.ConfigKey.AUDIO_VOICE_VOLUME: %VoiceVolumeSlider
}


func _ready() -> void:
	for config_key: ConfigManager.ConfigKey in sliders.keys():
		var bus_id := _to_bus_id(config_key)
		var volume: float = ConfigManager.get_value(config_key, 1.0)
		var slider: HSlider = sliders[config_key]
		slider.value = volume
		slider.value_changed.connect(
			func(value: float) -> void: set_volume(config_key, bus_id, value)
		)
		AudioServer.set_bus_volume_db(bus_id, volume)


func set_volume(config_key: ConfigManager.ConfigKey, bus_id: int, value: float) -> void:
	AudioServer.set_bus_volume_db(bus_id, linear_to_db(value))
	ConfigManager.set_value(config_key, value)
	AudioManager.play_button_sound()


func _to_bus_id(key: ConfigManager.ConfigKey) -> int:
	var bus_name: String = BUS_MAP[key]
	return AudioServer.get_bus_index(bus_name)
