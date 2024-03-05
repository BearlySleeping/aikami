extends Object
## The InventoryStacked, InventoryGrid and InventoryGridStacked classes derive from the Inventory class
## and apply different constraints on the basic inventory functionality. Combining these constraints gives
## us the functionality of the derived classes. The constraints are implemented in separate classes and can
## be found in the constraints directory:

var inventory: Inventory:
	set(new_inventory):
		assert(new_inventory, "Can't set inventory to null!")
		assert(inventory == null, "Inventory already set!")
		inventory = new_inventory
		_on_inventory_set()


func _init(p_inventory: Inventory) -> void:
	inventory = p_inventory


# Override this
func get_space_for(_item: InventoryItem) -> InventoryItemCount:
	return InventoryItemCount.zero()


# Override this
func has_space_for(_item: InventoryItem) -> bool:
	return false


# Override this
func reset() -> void:
	pass


# Override this
func serialize() -> Dictionary:
	return {}


# Override this
func deserialize(_source: Dictionary) -> bool:
	return true


# Override this
func _on_inventory_set() -> void:
	pass


# Override this
func on_item_added(_item: InventoryItem) -> void:
	pass


# Override this
func on_item_removed(_item: InventoryItem) -> void:
	pass


# Override this
func on_item_modified(_item: InventoryItem) -> void:
	pass
