class_name HurtBox extends Area2D

@export var damage: int = 1


# Called when the node enters the scene tree for the first time.
func _ready() -> void:
	area_entered.connect(_area_entered)


func _area_entered(a: Area2D) -> void:
	if a is HitBox:
		a.take_damage(self)
