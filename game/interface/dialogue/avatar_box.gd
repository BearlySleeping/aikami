extends TextureRect

@export var label_text: String:
	set(value):
		label.text = value

@onready var label: Label = $Label
