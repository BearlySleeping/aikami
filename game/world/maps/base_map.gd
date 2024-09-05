class_name BaseMap
extends Node2D

@export var tilemap: LevelTileMap
@export var gradient_texture: GradientTexture1D = preload(
	"res://assets/vfx/daynightcycle-gradient-texture.tres"
)
var canvas: CanvasModulate
var target_color: Color

func _free_level() -> void:
	PlayerManager.unparent_player(self)
	queue_free()

func _ready() -> void:
	self.y_sort_enabled = true
	PlayerManager.set_as_parent(self)
	SceneManager.scene_load_started.connect(_free_level)
	assert(tilemap, "Tilemap is required")
	PlayerManager.player.request_path_to_target.connect(tilemap.get_path_to_point)
	Hud.show_hud()
	TimeManager.set_running(true)
	Global.screen_type = Global.ScreenType.GAME
	if not gradient_texture:
		return
	_init_canvas()

func _init_canvas() -> void:
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
