class_name InventoryItemModel
extends BaseModel
## This model is used for saving the state of the inventory
## It is used for saving the state of the inventory to the database
## and for loading the state of the inventory from the database
## Do not confuse InventoryItemModel with InterfaceInventoryItem, InterfaceInventoryItem is used for the UI and the inventory grid
## It has the pure minimal data needed to recreate the inventory state, for more data about the item see ItemManager

## An unique identifier for the item, this has to match an id in ItemManager
## @example armor_helmet_iron
## @required
var id: String
## The amount of the item, this is the same as the stack size
## @default 1
var amount: int
## The position of the item to be used for the UI and the inventory grid system
## @default Vector2i(0, 0)
var position: Vector2i


func _init(data: Dictionary) -> void:
	assert(data.has("id"), "id is required")
	id = data.get("id")
	amount = data.get("amount", 1)
	position = data.get("position", Vector2i(0, 0))


func to_dict() -> Dictionary:
	var data: Dictionary = {
		"id": id,
		"amount": amount,
		"position": position,
	}
	return data
