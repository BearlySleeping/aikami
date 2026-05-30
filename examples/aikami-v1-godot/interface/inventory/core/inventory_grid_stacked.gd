@tool
class_name InventoryGridStacked
extends InventoryGrid

## Grid based inventory that supports item stacks.

const StacksConstraint := preload("../constraints/inventory_stacks_constraint.gd")


func _init() -> void:
	super()
	_constraint_manager.enable_stacks_constraint()


## Checks if the inventory has enough free space for the given item.
func has_place_for(item: InterfaceInventoryItem) -> bool:
	return _constraint_manager.has_space_for(item)


## Adds the given item stack to the inventory, automatically
##  merging with existing item stacks with the same prototype ID.
func add_item_automerge(item: InterfaceInventoryItem) -> bool:
	return _constraint_manager.get_stacks_constraint().add_item_automerge(item)


## Splits the given item stack into two. The newly created stack will
## have the size new_stack_size, while the old stack will contain the remainder.
func split(item: InterfaceInventoryItem, new_stack_size: int) -> InterfaceInventoryItem:
	return _constraint_manager.get_stacks_constraint().split_stack_safe(item, new_stack_size)


## Joins the item_src item stack with the item_dst stack.
func join(item_dst: InterfaceInventoryItem, item_src: InterfaceInventoryItem) -> bool:
	return _constraint_manager.get_stacks_constraint().join_stacks(item_dst, item_src)


## Returns the stack size of the given item.
static func get_item_stack_size(item: InterfaceInventoryItem) -> int:
	return StacksConstraint.get_item_stack_size(item)


## Sets the stack size of the given item. If the stack size is set to 0 the item will
## be removed from its directory and queued for deletion. If new_stack_size is greater
## than the maximum stack size or negative, the stack size will remain unchanged and
## the function will return false.
static func set_item_stack_size(item: InterfaceInventoryItem, new_stack_size: int) -> bool:
	return StacksConstraint.set_item_stack_size(item, new_stack_size)


## Returns the maximum stack size for the given item.
static func get_item_max_stack_size(item: InterfaceInventoryItem) -> int:
	return StacksConstraint.get_item_max_stack_size(item)


## Returns the stack size of the given item prototype.
func get_prototype_stack_size(prototype_id: String) -> int:
	return StacksConstraint.get_prototype_stack_size(prototype_id)


##  Returns the maximum stack size of the given item prototype.
func get_prototype_max_stack_size(prototype_id: String) -> int:
	return StacksConstraint.get_prototype_max_stack_size(prototype_id)


## Transfers the given item stack into the given inventory, joining it
## with any available item stacks with the same prototype ID.
func transfer_automerge(item: InterfaceInventoryItem, destination: Inventory) -> bool:
	return _constraint_manager.get_stacks_constraint().transfer_automerge(item, destination)


## Transfers the given item stack into the given inventory, splitting it up and joining
## it with available item stacks, as needed.
func transfer_autosplitmerge(item: InterfaceInventoryItem, destination: Inventory) -> bool:
	return _constraint_manager.get_stacks_constraint().transfer_autosplitmerge(item, destination)


func transfer_to(item: InterfaceInventoryItem, destination: Inventory, position: Vector2i) -> bool:
	return _constraint_manager.get_grid_constraint().transfer_to(
		item, destination._constraint_manager.get_grid_constraint(), position
	)


func get_mergeable_item_at(
	item: InterfaceInventoryItem, position: Vector2i
) -> InterfaceInventoryItem:
	return _constraint_manager.get_grid_constraint().get_mergeable_item_at(item, position)
