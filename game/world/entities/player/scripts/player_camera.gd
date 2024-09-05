class_name PlayerCamera extends Camera2D


# Called when the node enters the scene tree for the first time.
func _ready() -> void:
	SceneManager.tilemap_bounds_changed.connect( _update_limits )
	_update_limits( SceneManager.current_tilemap_bounds )

func _update_limits( bounds : Array[ Vector2 ] ) -> void:
	if bounds == []:
		return
	limit_left = int( bounds[0].x )
	limit_top = int( bounds[0].y )
	limit_right = int( bounds[1].x )
	limit_bottom = int( bounds[1].y )
