extends Control

@onready var settings_view: Control = %SettingsView
@onready var start_button: Button = %StartButton
@onready var reset_button: Button = %ResetButton


func _ready() -> void:
	var has_player := SaveManager.load_player_data()
	if !has_player:
		reset_button.hide()
	reset_focus()
	Global.screen_type = Global.ScreenType.MAIN_MENU
	TimeManager.set_running(false)
	Hud.hide_hud()


func _on_start_button_pressed() -> void:
	var open_ai_api_key: String = ConfigManager.get_value(
		ConfigManager.ConfigKey.API_OPEN_AI_KEY, ""
	)
	if not open_ai_api_key:
		settings_view.set_tab(2)
		settings_view.show()
		return
	var has_created_player := SaveManager.initialize()
	if has_created_player:
		SceneManager.load_new_fixed_scene(SceneManager.SceneName.MAIN)
	else:
		SceneManager.load_new_fixed_scene(SceneManager.SceneName.CHARACTER_CREATION)


func reset_focus() -> void:
	start_button.grab_focus()


func _on_quit_button_pressed() -> void:
	get_tree().quit()


func _on_option_button_pressed() -> void:
	settings_view.show()
	settings_view.reset_focus()
	_play_button_sound()


func _on_settings_view_back_button_pressed() -> void:
	settings_view.hide()
	reset_focus()


func _on_reset_button_pressed() -> void:
	SaveManager.reset()
	reset_button.hide()


func _play_button_sound() -> void:
	AudioManager.play_sfx(AudioManager.SFXName.MENU)
