@tool
class_name InventoryItemRefSlot
extends "inventory_item_slot_base.gd"

## Holds a reference to an inventory item.

signal inventory_changed

const Verify := preload("../constraints/inventory_verify.gd")
const KEY_ITEM_INDEX := "item_index"
const EMPTY_SLOT := -1

@export var _equipped_item := EMPTY_SLOT:
	set = _set_equipped_item_index

## Reference to an Inventory node.
var inventory: Inventory:
	get = _get_inventory,
	set = _set_inventory

var _wr_item: WeakRef = weakref(null)
var _wr_inventory: WeakRef = weakref(null)


func _set_equipped_item_index(new_value: int) -> void:
	_equipped_item = new_value
	equip_by_index(new_value)


func _ready() -> void:
	equip_by_index(_equipped_item)


func _set_inventory(p_inventory: Inventory) -> void:
	if p_inventory == _wr_inventory.get_ref():
		return

	if _get_inventory():
		_disconnect_inventory_signals()

	clear()
	_wr_inventory = weakref(p_inventory)
	inventory_changed.emit()

	if _get_inventory():
		_connect_inventory_signals()


func _connect_inventory_signals() -> void:
	if _get_inventory() == null:
		return

	if !_get_inventory().item_removed.is_connected(_on_item_removed):
		_get_inventory().item_removed.connect(_on_item_removed)


func _disconnect_inventory_signals() -> void:
	if _get_inventory() == null:
		return

	if _get_inventory().item_removed.is_connected(_on_item_removed):
		_get_inventory().item_removed.disconnect(_on_item_removed)


func _on_item_removed(_item: InterfaceInventoryItem) -> void:
	clear()


func _get_inventory() -> Inventory:
	return _wr_inventory.get_ref()


## Equips the given inventory item in the slot. If the slot already holds an item, clear() will be called first.
## Returns false if the clear call fails, the slot can't hold the given item, or already holds the given item.
## Returns true otherwise.
func equip(item: InterfaceInventoryItem) -> bool:
	if !can_hold_item(item):
		return false

	if _wr_item.get_ref() == item:
		return false

	if get_item() && !clear():
		return false

	_wr_item = weakref(item)
	_equipped_item = _get_inventory().get_item_index(item)
	item_equipped.emit()
	return true


func equip_by_index(index: int) -> bool:
	if _get_inventory() == null:
		return false
	if index < 0:
		return false
	if index >= _get_inventory().get_item_count():
		return false
	return equip(_get_inventory().get_items()[index])


## Clears the item slot
func clear() -> bool:
	if get_item() == null:
		return false

	_wr_item = weakref(null)
	_equipped_item = EMPTY_SLOT
	cleared.emit()
	return true


## Returns the equipped item.
func get_item() -> InterfaceInventoryItem:
	return _wr_item.get_ref()


## Checks if the slot can hold the given item, i.e. inventory contains the given item and the item is not null.
## This method can be overridden to implement item slots that can only hold specific items.
func can_hold_item(item: InterfaceInventoryItem) -> bool:
	if item == null:
		return false

	if _get_inventory() == null || !_get_inventory().has_item(item):
		return false

	return true


## Clears the item slot.
func reset() -> void:
	clear()


## Serializes the item slot into a dictionary.
func serialize() -> Dictionary:
	var result: Dictionary = {}
	var item: InterfaceInventoryItem = _wr_item.get_ref()

	if item && item.get_inventory():
		result[KEY_ITEM_INDEX] = item.get_inventory().get_item_index(item)

	return result


## Loads the item slot data from the given dictionary.
## @note inventory must be set prior to the deserialize call!
func deserialize(source: Dictionary) -> bool:
	if !Verify.dict(source, false, KEY_ITEM_INDEX, [TYPE_INT, TYPE_FLOAT]):
		return false

	reset()

	if source.has(KEY_ITEM_INDEX):
		var item_index: int = source[KEY_ITEM_INDEX]
		if !_equip_item_with_index(item_index):
			return false

	return true


func _equip_item_with_index(item_index: int) -> bool:
	if _get_inventory() == null:
		return false
	if item_index >= _get_inventory().get_item_count():
		return false
	equip(_get_inventory().get_items()[item_index])
	return true
