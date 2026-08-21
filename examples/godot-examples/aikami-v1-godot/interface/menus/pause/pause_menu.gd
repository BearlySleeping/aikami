extends CanvasLayer

signal shown
signal hidden

var is_paused: bool = false

@onready var audio_stream_player: AudioStreamPlayer = %AudioStreamPlayer
@onready var tab_container: TabContainer = %TabContainer


func _ready() -> void:
	hide_pause_menu()


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
	if event.is_action_pressed("ui_right"):
		change_tab(1)
	elif event.is_action_pressed("ui_left"):
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


func play_audio(audio: AudioStream) -> void:
	audio_stream_player.stream = audio
	audio_stream_player.play()


func change_tab(index: int = 1) -> void:
	tab_container.current_tab = wrapi(
		tab_container.current_tab + index, 0, tab_container.get_tab_count()
	)
	tab_container.get_tab_bar().grab_focus()
