class_name BaseItemModel
extends BaseModel

## An unique identifier for the item
## @example armor_helmet_iron
## @required
var id: String
## The name of the item
## @required
var name: String
## The description of the item
## @optional
var description: String
## The weight of the item, can be 0 for no weight
## @default 1
var weight: float
## The maximum stack size of the item, can be -1 for infinite stacking
## @default 1
var max_stack_size: int
## The height of the item in the grid inventory
## @default 1
var height: float
## The width of the item in the grid inventory
## @default 1
var width: float
## The path to the image of the item to display in the inventory
## @required
var image_path: String


func _init(p_id: String, data: Dictionary) -> void:
	assert(p_id != "", "Id is required")
	assert(data.has("name"), "Name is required")
	assert(data.has("image_path"), "Image path is required")
	id = p_id
	name = data.get("name")
	image_path = data.get("image_path")
	description = data.get("description")
	weight = data.get("weight", 1)
	max_stack_size = data.get("max_stack_size", 1)
	height = data.get("height", 1)
	width = data.get("width", 1)


func to_dict() -> Dictionary:
	return {
		"name": name,
		"id": id,
		"description": description,
		"weight": weight,
		"max_stack_size": max_stack_size,
		"height": height,
		"width": width,
		"image_path": image_path
	}


func to_item_prototype_dict() -> Dictionary:
	return {
		"name": name,
		"description": description,
		"weight": weight,
		"max_stack_size": max_stack_size,
		"height": height,
		"width": width,
		"image_path": image_path
	}
