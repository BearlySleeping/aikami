extends Button

@export var action: String


func _init() -> void:
	toggle_mode = true


func _ready() -> void:
	set_process_unhandled_input(false)
	display_key()


func _toggled(value: bool) -> void:
	set_process_unhandled_input(value)
	if value:
		text = "press any key"
		release_focus()
	else:
		display_key()
		grab_focus()


func _unhandled_input(event: InputEvent) -> void:
	if event.pressed:
		InputMap.action_erase_events(action)
		InputMap.action_add_event(action, event)
		button_pressed = false
		ConfigManager.set_value(ConfigManager.ConfigKey.CONTROLS_MOVE_LEFT, event)


func display_key() -> void:
	var input_events := InputMap.action_get_events(action)
	if input_events.is_empty():
		return
	text = input_events[0].as_text()
