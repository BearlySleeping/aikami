class_name GameSaveData
extends BaseModel

var total_in_game_hours: int


func to_dict() -> Dictionary:
	return {
		"total_in_game_hours": total_in_game_hours,
	}


func _init(data: Dictionary) -> void:
	total_in_game_hours = data.get("total_in_game_hours", 0)
