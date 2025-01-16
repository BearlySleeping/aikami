extends Node2D

@onready var title: RichTextLabel = $Title
@onready var subtile: RichTextLabel = $Subtile

@export var text: String:
	set(value):
		if text == value:
			return
		subtile.text = value
		text = value
