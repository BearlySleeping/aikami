class_name NPCContainer
extends HBoxContainer

# use type to say that this is void function
signal done_button_pressed()

@export var text := "":
	set(value):
		if value == text:
			return
		text = value
		_set_text()

@onready var npc_text_label: RichTextLabel = %NPCTextLabel


func _ready() -> void:
	_set_text()

func _set_text() -> void:
	if npc_text_label != null:
		npc_text_label.text = text


func _on_next_button_pressed() -> void:
	done_button_pressed.emit()

func clear() -> void:
	text = ""
