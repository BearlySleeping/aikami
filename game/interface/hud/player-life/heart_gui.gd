class_name HeartGUI extends Control

var value: int = 2:
	set(p_value):
		value = p_value
		update_sprite()

@onready var sprite: Sprite2D = $Sprite2D


func update_sprite() -> void:
	sprite.frame = value
