class_name GameSaveData
extends BaseModel

var total_in_game_hours: int
var current_scene: String
var player: Dictionary
var items: Array
var persistence: Array
var quests: Array


func to_dict() -> Dictionary:
	return {
		"total_in_game_hours": total_in_game_hours,
		"current_scene": current_scene,
		"player": player,
		"items": items,
		"persistence": persistence,
		"quests": quests,
	}


func _init(data: Dictionary) -> void:
	total_in_game_hours = data.get("total_in_game_hours", 0)
	current_scene = data.get("current_scene", "")
	player = data.get("player", {})
	items = data.get("items", [])
	persistence = data.get("persistence", [])
	quests = data.get("quests", [])
