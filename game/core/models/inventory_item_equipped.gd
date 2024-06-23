class_name InventoryEquippedItemModel
extends BaseModel
## This model is used for saving the state of the inventory
## It is used for saving the state of the inventory to the database
## and for loading the state of the inventory from the database
## Do not confuse InventoryItemModel with InventoryItem, InventoryItem is used for the UI and the inventory grid
## It has the pure minimal data needed to recreate the inventory state, for more data about the item see ItemManager

## An unique identifier for the item, this has to match an id in ItemManager
## @example armor_helmet_iron
## @required
var id: String
## The slot of the item
## @required
var slot: Enum.EquippedSlot


func _init(data: Dictionary) -> void:
	assert(data.has("id"), "id is required")
	assert(data.has("slot"), "slot is required")
	id = data.get("id")
	slot = data.get("slot")


func to_dict() -> Dictionary:
	return {"id": id, "slot": slot}
