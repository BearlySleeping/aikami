class_name AnimationModel

var columns: int
var rows: int
var animation_positions: Dictionary


func _init(p_animation_positions: Dictionary, _columns: int, _rows: int) -> void:
	columns = _columns
	rows = _rows
	animation_positions = p_animation_positions
