@tool
class_name InventoryItemSlotBase
extends Node

## Emitted when an item is placed in the slot.
signal item_equipped
## Emitted when the slot is cleared.
signal cleared


# Override this
func equip(_item: InterfaceInventoryItem) -> bool:
	return false


# Override this
func clear() -> bool:
	return false


# Override this
func get_item() -> InterfaceInventoryItem:
	return null


# Override this
func can_hold_item(_item: InterfaceInventoryItem) -> bool:
	return false


# Override this
func reset() -> void:
	pass


# Override this
func serialize() -> Dictionary:
	return {}


# Override this
func deserialize(_source: Dictionary) -> bool:
	return false
