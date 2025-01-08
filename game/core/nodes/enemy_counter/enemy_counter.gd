class_name EnemyCounter extends Node2D

signal enemies_defeated


func _ready() -> void:
	child_exiting_tree.connect(_on_enemy_destroyed)


func _on_enemy_destroyed(e: Node2D) -> void:
	if e is Enemy:
		if enemy_count() <= 1:
			enemies_defeated.emit()


func enemy_count() -> int:
	var count: int = 0
	for child in get_children():
		if child is Enemy:
			count += 1
	return count
