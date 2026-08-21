class_name QuestModel
extends BaseModel

var id: String
var title: String
var description: String
var steps: PackedStringArray

var reward_xp: int
var reward_items: Array[BaseItemModel] = []

var completed_steps: PackedStringArray
var is_complete: bool = false


func _init(
	p_id: String, p_is_complete: bool, p_completed_steps: PackedStringArray, data: Dictionary
) -> void:
	id = p_id
	title = data["title"]
	description = data["description"]
	steps = PackedStringArray(data["steps"])
	reward_xp = data["reward_xp"]
	reward_items = []
	is_complete = p_is_complete
	completed_steps = p_completed_steps


func to_dict() -> Dictionary:
	var data: Dictionary = {
		"id": id,
		"title": title,
		"description": description,
		"steps": steps,
		"reward_xp": reward_xp,
		"reward_items": []
	}
	return data
