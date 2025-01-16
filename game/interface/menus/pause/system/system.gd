extends Control

signal hide_pause_menu

@onready var sfx_bus_id := AudioServer.get_bus_index("SFX")
@onready var music_bus_id := AudioServer.get_bus_index("Music")
@onready var music_slider: HSlider = %MusicSlider
@onready var sfx_slider: HSlider = %SFXSlider


func _on_music_slider_value_changed(value: float) -> void:
	AudioServer.set_bus_volume_db(music_bus_id, linear_to_db(value))
	AudioServer.set_bus_mute(music_bus_id, value < .05)
	ConfigManager.set_value(ConfigManager.ConfigKey.AUDIO_SFX_VOLUME, value)


func _on_sfx_slider_value_changed(value: float) -> void:
	AudioServer.set_bus_volume_db(sfx_bus_id, linear_to_db(value))
	AudioServer.set_bus_mute(sfx_bus_id, value < .05)
	ConfigManager.set_value(ConfigManager.ConfigKey.AUDIO_MUSIC_VOLUME, value)


func _on_return_to_game_button_pressed() -> void:
	hide_pause_menu.emit()


func _on_main_menu_button_pressed() -> void:
	SceneManager.load_new_fixed_scene(SceneManager.SceneName.MAIN_MENU)
	hide_pause_menu.emit()


func _on_quit_button_pressed() -> void:
	get_tree().quit()
