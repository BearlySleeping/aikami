@tool
class_name Inventory
extends Node

## Basic inventory class. Supports basic inventory operations (adding, removing, transferring items etc.).
## Can contain an unlimited amount of items.

## Emitted when an item has been added to the inventory.
signal item_added(item: InterfaceInventoryItem)
## Emitted when an item has been removed from the inventory.
signal item_removed(item: InterfaceInventoryItem)
## Emitted when an item from the inventory has been modified.
signal item_modified(item: InterfaceInventoryItem)
## Emitted when the contents of the inventory have changed.
signal contents_changed

const KEY_NODE_NAME := "node_name"
const KEY_CONSTRAINTS := "constraints"
const KEY_ITEMS := "items"

const ConstraintManager := preload("../constraints/inventory_constraint_manager.gd")
const Verify := preload("../constraints/inventory_verify.gd")

var _items: Array[InterfaceInventoryItem] = []
var _constraint_manager: ConstraintManager


func enable_weight_constraint(capacity: float = 0.0) -> void:
	_constraint_manager.enable_weight_constraint(capacity)


static func get_item_script() -> Script:
	return preload("inventory_item.gd")


func _enter_tree() -> void:
	for child in get_children():
		if not child is InterfaceInventoryItem:
			continue
		if has_item(child):
			continue
		_items.append(child)


func _exit_tree() -> void:
	_items.clear()


func _init() -> void:
	_constraint_manager = ConstraintManager.new(self)


func _ready() -> void:
	for item in get_items():
		_connect_item_signals(item)


func on_item_added(item: InterfaceInventoryItem) -> void:
	_items.append(item)
	contents_changed.emit()
	_connect_item_signals(item)
	if _constraint_manager:
		_constraint_manager.on_item_added(item)
	item_added.emit(item)


func on_item_removed(item: InterfaceInventoryItem) -> void:
	_items.erase(item)
	contents_changed.emit()
	_disconnect_item_signals(item)
	if _constraint_manager:
		_constraint_manager.on_item_removed(item)
	item_removed.emit(item)


## Moves the inventory item at index from to the new index to. This does not change the order of the inventory child nodes.
## It only affects the internal item ordering.
func move_item(from: int, to: int) -> void:
	assert(from >= 0)
	assert(from < _items.size())
	assert(to >= 0)
	assert(to < _items.size())
	if from == to:
		return

	var item := _items[from]
	_items.remove_at(from)
	_items.insert(to, item)

	contents_changed.emit()


## Returns the internal item index of the given item. Returns -1 if the item is not inside the inventory.
func get_item_index(item: InterfaceInventoryItem) -> int:
	return _items.find(item)


## Returns the number of items in the inventory.
func get_item_count() -> int:
	return _items.size()


func _connect_item_signals(item: InterfaceInventoryItem) -> void:
	if !item.properties_changed.is_connected(_emit_item_modified):
		item.properties_changed.connect(_emit_item_modified.bind(item))


func _disconnect_item_signals(item: InterfaceInventoryItem) -> void:
	if item.prototype_id_changed.is_connected(_emit_item_modified):
		item.prototype_id_changed.disconnect(_emit_item_modified)
	if item.properties_changed.is_connected(_emit_item_modified):
		item.properties_changed.disconnect(_emit_item_modified)


func _emit_item_modified(item: InterfaceInventoryItem) -> void:
	_constraint_manager.on_item_modified(item)
	item_modified.emit(item)


## Returns an array containing all the items in the inventory.
func get_items() -> Array[InterfaceInventoryItem]:
	return _items


## Checks if the inventory contains the given item.
func has_item(item: InterfaceInventoryItem) -> bool:
	return item in _items


## Adds the given item to the inventory.
func add_item(item: InterfaceInventoryItem) -> bool:
	if !can_add_item(item):
		return false

	if item.get_parent():
		item.get_parent().remove_child(item)

	add_child(item)
	if Engine.is_editor_hint():
		item.owner = get_tree().edited_scene_root
	return true


## Checks if the given item can be added to the inventory taking inventory constraints (capacity, grid space etc.)
## and the result of can_hold_item(item) into account.
func can_add_item(item: InterfaceInventoryItem) -> bool:
	if item == null || has_item(item):
		Logger.warn("Item already in inventory")
		return false

	if !can_hold_item(item):
		Logger.warn("Item cannot be added to inventory")
		return false

	if !_constraint_manager.has_space_for(item):
		Logger.warn("Inventory is full")
		return false

	return true


## Checks if the inventory can hold the given item. Always returns true and can be overridden to make
## the inventory only accept items with specific properties.
## Does not check inventory constraints such as capacity or grid space. Those checks are done by can_add_item(item).
func can_hold_item(_item: InterfaceInventoryItem) -> bool:
	return true


## Creates an InterfaceInventoryItem based on the given prototype ID and adds it to the inventory.
## Returns null if the item cannot be added.
func create_and_add_item(item: InventoryItemModel) -> InterfaceInventoryItem:
	var inventory_item: InterfaceInventoryItem = InterfaceInventoryItem.new(item, self)
	if add_item(inventory_item):
		return inventory_item

	inventory_item.free()
	return null


## Removes the given item from the inventory.
func remove_item(item: InterfaceInventoryItem) -> bool:
	if !_can_remove_item(item):
		return false

	remove_child(item)
	return true


func _can_remove_item(item: InterfaceInventoryItem) -> bool:
	return item && has_item(item)


## Removes the all items from the inventory.
func remove_all_items() -> void:
	while get_child_count() > 0:
		remove_child(get_child(0))
	_items = []


## Returns the first found item with the given prototype ID.
func get_item_by_id(prototype_id: String) -> InterfaceInventoryItem:
	for item in get_items():
		if item.prototype_id == prototype_id:
			return item

	return null


## Returns an array of items with the given prototype ID.
func get_items_by_id(prototype_id: String) -> Array[InterfaceInventoryItem]:
	var result: Array[InterfaceInventoryItem] = []

	for item in get_items():
		if item.prototype_id == prototype_id:
			result.append(item)

	return result


## Checks if the inventory contains an item with the given prototype ID.
func has_item_by_id(prototype_id: String) -> bool:
	return !!get_item_by_id(prototype_id)


## Transfers the given item into the given inventory.
func transfer(item: InterfaceInventoryItem, destination: Inventory) -> bool:
	if !_can_remove_item(item) || !destination.can_add_item(item):
		return false

	remove_item(item)
	destination.add_item(item)
	return true


## Resets the inventory to its default state. This includes clearing its contents and resetting all properties.
func reset() -> void:
	clear()
	_constraint_manager.reset()


## Clears all items from the inventory.
func clear() -> void:
	for item in get_items():
		item.queue_free()
	remove_all_items()
