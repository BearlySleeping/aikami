class_name Plant extends Node2D

@onready var animation_player: AnimationPlayer = $AnimationPlayer


# Called when the node enters the scene tree for the first time.
func _ready() -> void:
	$HitBox.damaged.connect(take_damage)


func take_damage(_damage: HurtBox) -> void:
	animation_player.play("destroy")
	await animation_player.animation_finished
	queue_free()
