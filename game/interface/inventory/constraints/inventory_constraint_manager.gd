extends RefCounted
## Implements a constraint manager class

enum Configuration {
	WEIGHT_STACK_GRID,
	WEIGHT_STACK,
	WEIGHT_GRID,
	STACK_GRID,
	WEIGHT,
	STACK,
	GRID,
	DEFAULT,
}

const KEY_WEIGHT_CONSTRAINT := "weight_constraint"
const KEY_STACKS_CONSTRAINT := "stacks_constraint"
const KEY_GRID_CONSTRAINT := "grid_constraint"

const Verify := preload("inventory_verify.gd")
const WeightConstraint := preload("inventory_weight_constraint.gd")
const StacksConstraint := preload("inventory_stacks_constraint.gd")
const GridConstraint := preload("inventory_grid_constraint.gd")

var inventory: Inventory:
	set(new_inventory):
		assert(new_inventory, "Can't set inventory to null!")
		assert(inventory == null, "Inventory already set!")
		inventory = new_inventory
		if _weight_constraint:
			_weight_constraint.inventory = inventory
		if _stacks_constraint:
			_stacks_constraint.inventory = inventory
		if _grid_constraint:
			_grid_constraint.inventory = inventory

var _weight_constraint: WeightConstraint
var _stacks_constraint: StacksConstraint
var _grid_constraint: GridConstraint


func _init(p_inventory: Inventory) -> void:
	inventory = p_inventory


func on_item_added(item: InventoryItem) -> void:
	assert(_enforce_constraints(item), "Failed to enforce constraints!")

	if _weight_constraint:
		_weight_constraint.on_item_added(item)
	if _stacks_constraint:
		_stacks_constraint.on_item_added(item)
	if _grid_constraint:
		_grid_constraint.on_item_added(item)


func on_item_removed(item: InventoryItem) -> void:
	if _weight_constraint:
		_weight_constraint.on_item_removed(item)
	if _stacks_constraint:
		_stacks_constraint.on_item_removed(item)
	if _grid_constraint:
		_grid_constraint.on_item_removed(item)


func on_item_modified(item: InventoryItem) -> void:
	if _weight_constraint:
		_weight_constraint.on_item_modified(item)
	if _stacks_constraint:
		_stacks_constraint.on_item_modified(item)
	if _grid_constraint:
		_grid_constraint.on_item_modified(item)


func _enforce_constraints(item: InventoryItem) -> bool:
	match get_configuration():
		Configuration.GRID:
			return _grid_constraint.move_item_to_free_spot(item)
		Configuration.WEIGHT_GRID:
			return _grid_constraint.move_item_to_free_spot(item)
		Configuration.STACK_GRID:
			if _grid_constraint.move_item_to_free_spot(item):
				return true
			_stacks_constraint.pack_item(item)
		Configuration.WEIGHT_STACK_GRID:
			if _grid_constraint.move_item_to_free_spot(item):
				return true
			_stacks_constraint.pack_item(item)

	return true


func get_configuration() -> int:
	if _weight_constraint && _stacks_constraint && _grid_constraint:
		return Configuration.WEIGHT_STACK_GRID

	if _weight_constraint && _stacks_constraint:
		return Configuration.WEIGHT_STACK

	if _weight_constraint && _grid_constraint:
		return Configuration.WEIGHT_GRID

	if _stacks_constraint && _grid_constraint:
		return Configuration.STACK_GRID

	if _weight_constraint:
		return Configuration.WEIGHT

	if _stacks_constraint:
		return Configuration.STACK

	if _grid_constraint:
		return Configuration.GRID

	return Configuration.DEFAULT


func get_space_for(item: InventoryItem) -> InventoryItemCount:
	match get_configuration():
		Configuration.WEIGHT:
			return _weight_constraint.get_space_for(item)
		Configuration.STACK_GRID:
			return _stacks_constraint.get_space_for(item)
		Configuration.GRID:
			return _grid_constraint.get_space_for(item)
		Configuration.WEIGHT_STACK:
			return _ws_get_space_for(item)
		Configuration.WEIGHT_GRID:
			return InventoryItemCount.min(
				_grid_constraint.get_space_for(item), _weight_constraint.get_space_for(item)
			)
		Configuration.STACK_GRID:
			return _sg_get_space_for(item)
		Configuration.WEIGHT_STACK_GRID:
			return InventoryItemCount.min(_sg_get_space_for(item), _ws_get_space_for(item))

	return InventoryItemCount.inf()


func _ws_get_space_for(item: InventoryItem) -> InventoryItemCount:
	var stack_size := InventoryItemCount.new(StacksConstraint.get_item_stack_size(item))
	var result := _weight_constraint.get_space_for(item).div(stack_size)
	return result


func _sg_get_space_for(item: InventoryItem) -> InventoryItemCount:
	var grid_space := _grid_constraint.get_space_for(item)
	var max_stack_size := InventoryItemCount.new(StacksConstraint.get_item_max_stack_size(item))
	var stack_size := InventoryItemCount.new(StacksConstraint.get_item_stack_size(item))
	var free_stacks_space := _stacks_constraint.get_free_stack_space_for(item)
	return grid_space.mul(max_stack_size).add(free_stacks_space).div(stack_size)


func has_space_for(item: InventoryItem) -> bool:
	match get_configuration():
		Configuration.WEIGHT:
			return _weight_constraint.has_space_for(item)
		Configuration.STACK:
			return _stacks_constraint.has_space_for(item)
		Configuration.GRID:
			return _grid_constraint.has_space_for(item)
		Configuration.WEIGHT_STACK:
			return _weight_constraint.has_space_for(item)
		Configuration.WEIGHT_GRID:
			return _weight_constraint.has_space_for(item) && _grid_constraint.has_space_for(item)
		Configuration.STACK_GRID:
			return _sg_has_space_for(item)
		Configuration.WEIGHT_STACK_GRID:
			return _sg_has_space_for(item) && _weight_constraint.has_space_for(item)

	return true


func _sg_has_space_for(item: InventoryItem) -> bool:
	if _grid_constraint.has_space_for(item):
		return true
	var stack_size := InventoryItemCount.new(StacksConstraint.get_item_stack_size(item))
	var free_stacks_space := _stacks_constraint.get_free_stack_space_for(item)
	return free_stacks_space.ge(stack_size)


func enable_weight_constraint(capacity: float = 0.0) -> void:
	assert(_weight_constraint == null, "Weight constraint is already enabled")
	_weight_constraint = WeightConstraint.new(inventory)
	_weight_constraint.capacity = capacity


func enable_stacks_constraint() -> void:
	assert(_stacks_constraint == null, "Stacks constraint is already enabled")
	_stacks_constraint = StacksConstraint.new(inventory)


func enable_grid_constraint(size: Vector2i = GridConstraint.DEFAULT_SIZE) -> void:
	assert(_grid_constraint == null, "Grid constraint is already enabled")
	_grid_constraint = GridConstraint.new(inventory)
	_grid_constraint.size = size


func get_weight_constraint() -> WeightConstraint:
	return _weight_constraint


func get_stacks_constraint() -> StacksConstraint:
	return _stacks_constraint


func get_grid_constraint() -> GridConstraint:
	return _grid_constraint


func reset() -> void:
	if get_weight_constraint():
		get_weight_constraint().reset()
	if get_stacks_constraint():
		get_stacks_constraint().reset()
	if get_grid_constraint():
		get_grid_constraint().reset()


func serialize() -> Dictionary:
	var result := {}

	if get_weight_constraint():
		result[KEY_WEIGHT_CONSTRAINT] = get_weight_constraint().serialize()
	if get_stacks_constraint():
		result[KEY_STACKS_CONSTRAINT] = get_stacks_constraint().serialize()
	if get_grid_constraint():
		result[KEY_GRID_CONSTRAINT] = get_grid_constraint().serialize()

	return result


func deserialize(source: Dictionary) -> bool:
	if !Verify.dict(source, false, KEY_WEIGHT_CONSTRAINT, TYPE_DICTIONARY):
		return false
	if !Verify.dict(source, false, KEY_STACKS_CONSTRAINT, TYPE_DICTIONARY):
		return false
	if !Verify.dict(source, false, KEY_GRID_CONSTRAINT, TYPE_DICTIONARY):
		return false

	reset()

	if source.has(KEY_WEIGHT_CONSTRAINT):
		if !get_weight_constraint().deserialize(source[KEY_WEIGHT_CONSTRAINT]):
			return false
	if source.has(KEY_STACKS_CONSTRAINT):
		if !get_stacks_constraint().deserialize(source[KEY_STACKS_CONSTRAINT]):
			return false
	if source.has(KEY_GRID_CONSTRAINT):
		if !get_grid_constraint().deserialize(source[KEY_GRID_CONSTRAINT]):
			return false

	return true
