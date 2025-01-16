extends Node2D

@onready var command_menu: CommandMenu = %CommandMenu
@onready var command_label: Label = %CommandLabel


func _on_command_menu_command_selected(command: Resource) -> void:
	command_label.text = "use " + command.name


func _ready() -> void:
	Global.__set_playground_mode()


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("pause_menu"):
		command_menu.reset()
