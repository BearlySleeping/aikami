extends "inventory_constraint.gd"
## Implements the weight constraint, which limits the inventory to a given weight-based capacity.

signal capacity_changed
signal occupied_space_changed

const KEY_WEIGHT := "weight"
const KEY_CAPACITY := "capacity"
const KEY_OCCUPIED_SPACE := "occupied_space"

const Verify := preload("inventory_verify.gd")
const WeightConstraint := preload("inventory_weight_constraint.gd")
const StacksConstraint := preload("inventory_stacks_constraint.gd")

var capacity: float:
	set(new_capacity):
		if new_capacity < 0.0:
			new_capacity = 0.0
		if new_capacity == capacity:
			return
		if new_capacity > 0.0 && occupied_space > new_capacity:
			return
		capacity = new_capacity
		capacity_changed.emit()

var occupied_space: float:
	get:
		return _occupied_space
	set(new_occupied_space):
		assert(false, "occupied_space is read-only!")

var _occupied_space: float


func _on_inventory_set() -> void:
	_calculate_occupied_space()


func on_item_added(_item: InterfaceInventoryItem) -> void:
	_calculate_occupied_space()


func on_item_removed(_item: InterfaceInventoryItem) -> void:
	_calculate_occupied_space()


func on_item_modified(_item: InterfaceInventoryItem) -> void:
	_calculate_occupied_space()


func has_unlimited_capacity() -> bool:
	return capacity == 0.0


func get_free_space() -> float:
	if has_unlimited_capacity():
		return capacity

	var free_space: float = capacity - _occupied_space
	if free_space < 0.0:
		free_space = 0.0
	return free_space


func _calculate_occupied_space() -> void:
	var old_occupied_space := _occupied_space
	_occupied_space = 0.0
	for item in inventory.get_items():
		_occupied_space += WeightConstraint.get_item_weight(item)

	if _occupied_space != old_occupied_space:
		emit_signal("occupied_space_changed")

	if !Engine.is_editor_hint():
		assert(has_unlimited_capacity() || _occupied_space <= capacity, "Inventory overflow!")


static func get_item_unit_weight(item: InterfaceInventoryItem) -> float:
	var item_data := item.get_metadata()
	var weight := item_data.weight
	return weight


static func get_item_weight(item: InterfaceInventoryItem) -> float:
	if item == null:
		return -1.0
	return StacksConstraint.get_item_stack_size(item) * get_item_unit_weight(item)


func get_space_for(item: InterfaceInventoryItem) -> InventoryItemCount:
	if has_unlimited_capacity():
		return InventoryItemCount.inf()
	var unit_weight := WeightConstraint.get_item_unit_weight(item)
	return InventoryItemCount.new(floor(get_free_space() / unit_weight))


func has_space_for(item: InterfaceInventoryItem) -> bool:
	if has_unlimited_capacity():
		return true
	var item_weight := WeightConstraint.get_item_weight(item)
	return get_free_space() >= item_weight


func reset() -> void:
	capacity = 0.0


func serialize() -> Dictionary:
	var result := {}

	result[KEY_CAPACITY] = capacity
	# TODO: Check if this is needed
	result[KEY_OCCUPIED_SPACE] = _occupied_space

	return result


func deserialize(source: Dictionary) -> bool:
	if (
		!Verify.dict(source, true, KEY_CAPACITY, TYPE_FLOAT)
		|| !Verify.dict(source, true, KEY_OCCUPIED_SPACE, TYPE_FLOAT)
	):
		return false

	reset()
	capacity = source[KEY_CAPACITY]
	# TODO: Check if this is needed
	_occupied_space = source[KEY_OCCUPIED_SPACE]

	return true
