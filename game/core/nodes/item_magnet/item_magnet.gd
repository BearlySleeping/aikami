class_name ItemMagnet extends Area2D

@export var magnet_strength: float = 1.0
@export var play_magnet_audio: bool = false

var items: Array[ItemPickup] = []
var speeds: Array[float] = []

@onready var audio: AudioStreamPlayer2D = $AudioStreamPlayer2D


func _ready() -> void:
	area_entered.connect(_on_area_enter)


func _process(delta: float) -> void:
	for i in range(items.size() - 1, -1, -1):
		var item := items[i]
		if item == null:
			items.remove_at(i)
			speeds.remove_at(i)
		elif item.global_position.distance_to(global_position) > speeds[i]:
			speeds[i] += magnet_strength * delta
			item.position += item.global_position.direction_to(global_position) * speeds[i]
		else:
			item.global_position = global_position


func _on_area_enter(area: Area2D) -> void:
	if area.get_parent() is ItemPickup:
		var new_item := area.get_parent() as ItemPickup
		items.append(new_item)
		speeds.append(magnet_strength)
		new_item.set_physics_process(false)
		if play_magnet_audio:
			audio.play(0)
