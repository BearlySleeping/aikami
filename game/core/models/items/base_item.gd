class_name BaseItemModel
extends BaseModel

var id: String
var name: String
var description: String


func _init(p_id: String, data: Dictionary) -> void:
	id = p_id
	name = data.get("name", "")
	description = data.get("description", "")


func to_dict() -> Dictionary:
	return {"name": name, "id": id, "description": description}
