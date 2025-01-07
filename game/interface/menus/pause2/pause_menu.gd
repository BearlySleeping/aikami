extends CanvasLayer

signal shown
signal hidden

@onready var audio_stream_player: AudioStreamPlayer = $Control/AudioStreamPlayer

@onready var tab_container: TabContainer = $Control/TabContainer

var is_paused: bool = false

@onready var sfx_bus_id := AudioServer.get_bus_index("SFX")
@onready var music_bus_id := AudioServer.get_bus_index("Music")
@onready var music_slider: HSlider = %MusicSlider
@onready var sfx_slider: HSlider = %SFXSlider


func _ready() -> void:
	hide_pause_menu()
	var sfx_level: float = ConfigManager.get_value(ConfigManager.ConfigKey.AUDIO_SFX_VOLUME, 1.0)
	sfx_slider.value = sfx_level
	var music_level: float = ConfigManager.get_value(
		ConfigManager.ConfigKey.AUDIO_MUSIC_VOLUME, 1.0
	)
	music_slider.value = music_level


func _input(event: InputEvent) -> void:
	if Global.screen_type == Global.ScreenType.MAIN_MENU or Global.dialogue_active:
		return

	if event.is_action_pressed("pause_menu"):
		if is_paused:
			hide_pause_menu()
		else:
			show_pause_menu()
		return

	if not is_paused:
		return
	if event.is_action_pressed("right_bumper"):
		change_tab(1)
	elif event.is_action_pressed("left_bumper"):
		change_tab(-1)


func show_pause_menu() -> void:
	get_tree().paused = true
	visible = true
	is_paused = true
	TimeManager.set_running(false)
	Global.screen_type = Global.ScreenType.PAUSE_MENU
	get_viewport().set_input_as_handled()
	shown.emit()


func hide_pause_menu() -> void:
	get_tree().paused = false
	visible = false
	is_paused = false
	TimeManager.set_running(true)
	Global.screen_type = Global.ScreenType.GAME
	get_viewport().set_input_as_handled()
	hidden.emit()


func _on_music_slider_value_changed(value: float) -> void:
	AudioServer.set_bus_volume_db(music_bus_id, linear_to_db(value))
	AudioServer.set_bus_mute(music_bus_id, value < .05)
	ConfigManager.set_value(ConfigManager.ConfigKey.AUDIO_SFX_VOLUME, value)


func _on_sfx_slider_value_changed(value: float) -> void:
	AudioServer.set_bus_volume_db(sfx_bus_id, linear_to_db(value))
	AudioServer.set_bus_mute(sfx_bus_id, value < .05)
	ConfigManager.set_value(ConfigManager.ConfigKey.AUDIO_MUSIC_VOLUME, value)


func _on_return_to_game_button_pressed() -> void:
	hide_pause_menu()


func _on_main_menu_button_pressed() -> void:
	SceneManager.load_new_fixed_scene(SceneManager.SceneName.MAIN_MENU)
	hide_pause_menu()


func _on_quit_button_pressed() -> void:
	get_tree().quit()


func play_audio(audio: AudioStream) -> void:
	audio_stream_player.stream = audio
	audio_stream_player.play()


func change_tab(_i: int = 1) -> void:
	tab_container.current_tab = wrapi(
		tab_container.current_tab + _i, 0, tab_container.get_tab_count()
	)
	tab_container.get_tab_bar().grab_focus()
