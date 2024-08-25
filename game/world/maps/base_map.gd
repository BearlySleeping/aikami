class_name BaseMap
extends Node

@export var tilemap: BaseTileMap
@export
var gradient_texture: GradientTexture1D = preload("res://assets/vfx/daynightcycle-gradient-texture.tres")
var canvas: CanvasModulate
var target_color: Color

@onready var player: Player = $Player  # Adjust the path to your Player node


func _ready() -> void:
	assert(tilemap, "Tilemap is required")
	player.request_path_to_target.connect(tilemap.get_path_to_point)
	player.request_path_to_target.connect(tilemap.get_path_to_point)
	Hud.show_hud()
	TimeManager.set_running(true)
	Global.screen_type = Global.ScreenType.GAME
	if not gradient_texture:
		return
	canvas = CanvasModulate.new()
	_set_background_color()
	canvas.color = target_color
	add_child(canvas)
	TimeManager.game_time_changed.connect(
		func(_time: TimeManager.TimeModel) -> void: _set_background_color()
	)


func _set_background_color() -> void:
	# Calculate the color value from the gradient texture based on the current time
	var value := (sin(TimeManager.total_delta_time - PI / 2.0) + 1.0) / 2.0
	target_color = gradient_texture.gradient.sample(value)


func _process(delta: float) -> void:
	if target_color and canvas.color != target_color:
		canvas.color = canvas.color.lerp(target_color, TimeManager.TIME_SPEED * delta)
