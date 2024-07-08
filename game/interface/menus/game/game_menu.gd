extends CanvasLayer

signal return_to_game
signal main_menu


func _ready() -> void:
	visible = false


func _input(event: InputEvent) -> void:
	if (
		Global.screen_type == Global.ScreenType.MAIN_MENU
		or Global.screen_type == Global.ScreenType.PAUSE_MENU
		or not event.is_action_pressed("game_menu")
	):
		return
	visible = !visible
	TimeManager.set_running(!visible)
	Global.screen_type = Global.ScreenType.GAME_MENU if visible else Global.ScreenType.GAME


func _on_return_to_game_button_pressed() -> void:
	visible = false
