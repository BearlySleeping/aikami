@tool
class_name InventoryGrid
extends Inventory
## Inventory that has a limited capacity in terms of space.
## The inventory capacity is defined by its width and height.

## Emitted when the size of the inventory has changed.
signal size_changed

const DEFAULT_SIZE := Vector2i(10, 10)

## The size of the inventory (width and height).
## @default DEFAULT_SIZE
@export var size := DEFAULT_SIZE:
	get:
		if _constraint_manager == null:
			return DEFAULT_SIZE
		if _constraint_manager.get_grid_constraint() == null:
			return DEFAULT_SIZE
		return _constraint_manager.get_grid_constraint().size
	set(new_size):
		_constraint_manager.get_grid_constraint().size = new_size


func _init() -> void:
	super()
	_constraint_manager.enable_grid_constraint()
	_constraint_manager.get_grid_constraint().size_changed.connect(
		func() -> void: size_changed.emit()
	)


## Returns the position of the given item in the inventory.
func get_item_position(item: InterfaceInventoryItem) -> Vector2i:
	return _constraint_manager.get_grid_constraint().get_item_position(item)


## Returns the size of the given item.
func get_item_size(item: InterfaceInventoryItem) -> Vector2i:
	return _constraint_manager.get_grid_constraint().get_item_size(item)


## Returns the position and size of the given item in the inventory.
func get_item_rect(item: InterfaceInventoryItem) -> Rect2i:
	return _constraint_manager.get_grid_constraint().get_item_rect(item)


## Checks if the item is rotated (indicated by the rotated property).
func is_item_rotated(item: InterfaceInventoryItem) -> bool:
	return ConstraintManager.GridConstraint.is_item_rotated(item)


## Checks if there's place for the item to be rotated.
func can_rotate_item(item: InterfaceInventoryItem) -> bool:
	return _constraint_manager.get_grid_constraint().can_rotate_item(item)


## Checks if the item rotation is positive (indicated by the positive_rotation property).
func is_item_rotation_positive(item: InterfaceInventoryItem) -> bool:
	return ConstraintManager.GridConstraint.is_item_rotation_positive(item)


## Adds the given to the inventory, at the given position.
func add_item_at(item: InterfaceInventoryItem, position: Vector2i) -> bool:
	return _constraint_manager.get_grid_constraint().add_item_at(item, position)


## Creates an InterfaceInventoryItem based on the given prototype ID and adds it to the inventory
## at the given position. Returns null if the item cannot be added.
func create_and_add_item_at(item: InventoryItemModel) -> InterfaceInventoryItem:
	return _constraint_manager.get_grid_constraint().create_and_add_item_at(item)


## Returns the item at the given position in the inventory. Returns null if the given field is empty.
func get_item_at(position: Vector2i) -> InterfaceInventoryItem:
	return _constraint_manager.get_grid_constraint().get_item_at(position)


func get_items_under(rect: Rect2i) -> Array[InterfaceInventoryItem]:
	return _constraint_manager.get_grid_constraint().get_items_under(rect)


## Moves the given item in the inventory to the new given position.
func move_item_to(item: InterfaceInventoryItem, position: Vector2i) -> bool:
	return _constraint_manager.get_grid_constraint().move_item_to(item, position)


## Transfers the given item to the given inventory to the given position.
func transfer_to(item: InterfaceInventoryItem, destination: Inventory, position: Vector2i) -> bool:
	return _constraint_manager.get_grid_constraint().transfer_to(
		item, destination._constraint_manager.get_grid_constraint(), position
	)


## Checks if the given rectangle is not occupied by any items (with a given optional exception).
func rect_free(rect: Rect2i, exception: InterfaceInventoryItem = null) -> bool:
	return _constraint_manager.get_grid_constraint().rect_free(rect, exception)


## Finds a free place for the given item. Returns a dictionary with two fields:
## success and position. If success is true a free place has been found
## and is stored in the position field. Otherwise success is set to false.
func find_free_place(item: InterfaceInventoryItem) -> Dictionary:
	return _constraint_manager.get_grid_constraint().find_free_place(item)


## Sorts the inventory items by size.
func sort() -> bool:
	return _constraint_manager.get_grid_constraint().sort()
