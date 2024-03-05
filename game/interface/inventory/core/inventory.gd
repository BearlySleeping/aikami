@tool
class_name Inventory
extends Node

## Basic inventory class. Supports basic inventory operations (adding, removing, transferring items etc.).
## Can contain an unlimited amount of items.

## Emitted when an item has been added to the inventory.
signal item_added(item: InventoryItem)
## Emitted when an item has been removed from the inventory.
signal item_removed(item: InventoryItem)
## Emitted when an item from the inventory has been modified.
signal item_modified(item: InventoryItem)
## Emitted when the contents of the inventory have changed.
signal contents_changed
## Emitted when the item_protoset property has been changed.
signal protoset_changed

const KEY_NODE_NAME := "node_name"
const KEY_ITEM_PROTOSET := "item_protoset"
const KEY_CONSTRAINTS := "constraints"
const KEY_ITEMS := "items"

const ConstraintManager := preload("../constraints/inventory_constraint_manager.gd")
const Verify := preload("../constraints/inventory_verify.gd")

@export var item_protoset: InventoryItemProtoset:
	set(new_item_protoset):
		if new_item_protoset == item_protoset:
			return
		# TODO: Maybe the inventory should be cleared here?
		if not _items.is_empty():
			return
		item_protoset = new_item_protoset
		protoset_changed.emit()
		update_configuration_warnings()

var _items: Array[InventoryItem] = []
var _constraint_manager: ConstraintManager


func _get_configuration_warnings() -> PackedStringArray:
	if item_protoset == null:
		return PackedStringArray(
			[
				(
					"This inventory node has no protoset. Set the 'item_protoset' field to be able to "
					+ "populate the inventory with items."
				)
			]
		)
	return PackedStringArray()


static func get_item_script() -> Script:
	return preload("inventory_item.gd")


func _enter_tree() -> void:
	for child in get_children():
		if not child is InventoryItem:
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


func on_item_added(item: InventoryItem) -> void:
	_items.append(item)
	contents_changed.emit()
	_connect_item_signals(item)
	if _constraint_manager:
		_constraint_manager.on_item_added(item)
	item_added.emit(item)


func on_item_removed(item: InventoryItem) -> void:
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
func get_item_index(item: InventoryItem) -> int:
	return _items.find(item)


## Returns the number of items in the inventory.
func get_item_count() -> int:
	return _items.size()


func _connect_item_signals(item: InventoryItem) -> void:
	if !item.protoset_changed.is_connected(_emit_item_modified):
		item.protoset_changed.connect(_emit_item_modified.bind(item))
	if !item.prototype_id_changed.is_connected(_emit_item_modified):
		item.prototype_id_changed.connect(_emit_item_modified.bind(item))
	if !item.properties_changed.is_connected(_emit_item_modified):
		item.properties_changed.connect(_emit_item_modified.bind(item))


func _disconnect_item_signals(item: InventoryItem) -> void:
	if item.protoset_changed.is_connected(_emit_item_modified):
		item.protoset_changed.disconnect(_emit_item_modified)
	if item.prototype_id_changed.is_connected(_emit_item_modified):
		item.prototype_id_changed.disconnect(_emit_item_modified)
	if item.properties_changed.is_connected(_emit_item_modified):
		item.properties_changed.disconnect(_emit_item_modified)


func _emit_item_modified(item: InventoryItem) -> void:
	_constraint_manager.on_item_modified(item)
	item_modified.emit(item)


## Returns an array containing all the items in the inventory.
func get_items() -> Array[InventoryItem]:
	return _items


## Checks if the inventory contains the given item.
func has_item(item: InventoryItem) -> bool:
	return item in _items


## Adds the given item to the inventory.
func add_item(item: InventoryItem) -> bool:
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
func can_add_item(item: InventoryItem) -> bool:
	if item == null || has_item(item):
		return false

	if !can_hold_item(item):
		return false

	if !_constraint_manager.has_space_for(item):
		return false

	return true


## Checks if the inventory can hold the given item. Always returns true and can be overridden to make
## the inventory only accept items with specific properties.
## Does not check inventory constraints such as capacity or grid space. Those checks are done by can_add_item(item).
func can_hold_item(_item: InventoryItem) -> bool:
	return true


## Creates an InventoryItem based on the given prototype ID and adds it to the inventory.
## Returns null if the item cannot be added.
func create_and_add_item(prototype_id: String) -> InventoryItem:
	var item: InventoryItem = InventoryItem.new()
	item.protoset = item_protoset
	item.prototype_id = prototype_id
	if add_item(item):
		return item

	item.free()
	return null


## Removes the given item from the inventory.
func remove_item(item: InventoryItem) -> bool:
	if !_can_remove_item(item):
		return false

	remove_child(item)
	return true


func _can_remove_item(item: InventoryItem) -> bool:
	return item && has_item(item)


## Removes the all items from the inventory.
func remove_all_items() -> void:
	while get_child_count() > 0:
		remove_child(get_child(0))
	_items = []


## Returns the first found item with the given prototype ID.
func get_item_by_id(prototype_id: String) -> InventoryItem:
	for item in get_items():
		if item.prototype_id == prototype_id:
			return item

	return null


## Returns an array of items with the given prototype ID.
func get_items_by_id(prototype_id: String) -> Array[InventoryItem]:
	var result: Array[InventoryItem] = []

	for item in get_items():
		if item.prototype_id == prototype_id:
			result.append(item)

	return result


## Checks if the inventory contains an item with the given prototype ID.
func has_item_by_id(prototype_id: String) -> bool:
	return !!get_item_by_id(prototype_id)


## Transfers the given item into the given inventory.
func transfer(item: InventoryItem, destination: Inventory) -> bool:
	if !_can_remove_item(item) || !destination.can_add_item(item):
		return false

	remove_item(item)
	destination.add_item(item)
	return true


## Resets the inventory to its default state. This includes clearing its contents and resetting all properties.
func reset() -> void:
	clear()
	item_protoset = null
	_constraint_manager.reset()


## Clears all items from the inventory.
func clear() -> void:
	for item in get_items():
		item.queue_free()
	remove_all_items()


## Serializes the inventory into a dictionary.
func serialize() -> Dictionary:
	var result: Dictionary = {}

	result[KEY_NODE_NAME] = name as String
	result[KEY_ITEM_PROTOSET] = item_protoset.resource_path
	result[KEY_CONSTRAINTS] = _constraint_manager.serialize()
	if !get_items().is_empty():
		result[KEY_ITEMS] = []
		for item in get_items():
			result[KEY_ITEMS].append(item.serialize())

	return result


## Loads the inventory data from the given dictionary.
func deserialize(source: Dictionary) -> bool:
	if (
		!Verify.dict(source, true, KEY_NODE_NAME, TYPE_STRING)
		|| !Verify.dict(source, true, KEY_ITEM_PROTOSET, TYPE_STRING)
		|| !Verify.dict(source, false, KEY_ITEMS, TYPE_ARRAY, TYPE_DICTIONARY)
		|| !Verify.dict(source, false, KEY_CONSTRAINTS, TYPE_DICTIONARY)
	):
		return false

	clear()
	item_protoset = null

	if !source[KEY_NODE_NAME].is_empty() && source[KEY_NODE_NAME] != name:
		name = source[KEY_NODE_NAME]
	item_protoset = load(source[KEY_ITEM_PROTOSET])
	# TODO: Check return value:
	if source.has(KEY_CONSTRAINTS):
		_constraint_manager.deserialize(source[KEY_CONSTRAINTS])
	if source.has(KEY_ITEMS):
		var items: Array = source[KEY_ITEMS]
		for item_dict: Dictionary in items:
			var item: InventoryItem = Inventory.get_item_script().new()
			# TODO: Check return value:
			item.deserialize(item_dict)
			assert(add_item(item), "Failed to add item '%s'. Inventory full?" % item.prototype_id)

	return true
