extends Node2D

@export var text: String:
	set(value):
		if text == value:
			return
		subtile.text = value
		text = value

@onready var title: RichTextLabel = $Title
@onready var subtile: RichTextLabel = $Subtile
