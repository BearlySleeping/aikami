extends CanvasLayer

@onready var player_hud: Control = %PlayerHUD


func _ready() -> void:
	visible = false


func show_hud() -> void:
	visible = true


func hide_hud() -> void:
	visible = false


func update_hp(hp: int, max_hp: int) -> void:
	player_hud.update_hp(hp, max_hp)


func update_heart(index: int, hp: int) -> void:
	player_hud.update_heart(index, hp)


func update_max_hp(max_hp: int) -> void:
	player_hud.update_heart(max_hp)
