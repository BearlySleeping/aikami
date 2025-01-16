class_name PlayerContainer
extends HBoxContainer

signal talk_button_pressed(text: String)
signal leave_button_pressed

@onready var player_input: TextEdit = %PlayerInput
@onready var talk_button: Button = %TalkButton
@onready var leave_button: Button = %LeaveButton


func _on_talk_button_pressed() -> void:
	talk_button_pressed.emit(player_input.text)
	clear()


func _on_leave_button_pressed() -> void:
	clear()
	leave_button_pressed.emit()


func _on_player_input_text_changed() -> void:
	talk_button.disabled = player_input.text == ""


func clear() -> void:
	player_input.text = ""
