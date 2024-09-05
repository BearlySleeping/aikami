extends Control

signal back_button_pressed

@onready var settings_tabs: TabContainer = $SettingsTabs


func set_tab(tab_index: int) -> void:
	settings_tabs.current_tab = tab_index
	reset_focus()


func reset_focus() -> void:
	settings_tabs.get_current_tab_control().grab_focus()


func _on_back_button_pressed() -> void:
	back_button_pressed.emit()
	_play_button_sound()


func _play_button_sound() -> void:
	AudioManager.play_sfx(AudioManager.SFXName.MENU)
