class_name QuestModel
extends BaseModel

var id: int
var title: String
var description: String
var steps : Array[ String ]

var reward_xp : int
var reward_items : Array[ BaseItemModel ] = []



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
