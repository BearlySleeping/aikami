@tool
class_name InventoryItemSlot
extends "inventory_item_slot_base.gd"

## Holds an inventory item.

##
signal protoset_changed

const Verify := preload("../constraints/inventory_verify.gd")
const KEY_ITEM := "item"

##  An InventoryItemProtoset resource containing item prototypes that the slot can receive.
## @required
var item_protoset: InventoryItemProtoset:
	set(new_item_protoset):
		if new_item_protoset == item_protoset:
			return
		if _item:
			_item = null
		item_protoset = new_item_protoset
		protoset_changed.emit()
## If set to true, the clear() method will try to return the item to its original inventory.
## @default true
@export var remember_source_inventory := true

var _wr_source_inventory: WeakRef = weakref(null)
var _item: InventoryItem


## Equips the given inventory item in the slot. If the slot already contains an item, clear() will be called first.
## Returns false if the clear call fails, the slot can't hold the given item, or already holds the given item.
## Returns true otherwise.
func equip(item: InventoryItem) -> bool:
	if !can_hold_item(item):
		return false

	if item.get_parent() == self:
		return false

	if get_item() && !clear():
		return false

	_wr_source_inventory = weakref(item.get_inventory())

	if item.get_parent():
		item.get_parent().remove_child(item)

	add_child(item)
	if Engine.is_editor_hint():
		item.owner = get_tree().edited_scene_root
	return true


func on_item_added(item: InventoryItem) -> void:
	_item = item
	item_equipped.emit()


## Clears the item slot. If remember_source_inventory is true,
## the method will try to return the item to its original inventory.
## Returns false if the item can't be returned, or if the slot is already empty.
func clear() -> bool:
	return _clear_impl(remember_source_inventory)


func _clear_impl(return_item: bool) -> bool:
	if get_item() == null:
		return false

	if return_item:
		_return_item_to_source_inventory()
		return true

	remove_child(get_item())
	return true


func _return_item_to_source_inventory() -> bool:
	var inventory: Inventory = _wr_source_inventory.get_ref() as Inventory
	if inventory:
		if inventory.add_item(get_item()):
			return true
	return false


func on_item_removed() -> void:
	_item = null
	_wr_source_inventory = weakref(null)
	cleared.emit()


## InventoryItem - Returns the equipped item.
## @note this method will not free the item if remember_source_inventory is false.
func get_item() -> InventoryItem:
	return _item


## Checks if the slot can hold the given item, i.e. the item has the same protoset as the slot and is not null.
## This method can be overridden to implement item slots that can only hold specific items.
func can_hold_item(item: InventoryItem) -> bool:
	assert(item_protoset, "Item protoset not set!")
	if item == null:
		return false
	if item_protoset != item.protoset:
		return false

	return true


## Clears the item slot and queues the contained item (if any) for deletion.
func reset() -> void:
	if _item:
		_item.queue_free()
	_clear_impl(false)


## Serializes the item slot into a dictionary.
func serialize() -> Dictionary:
	var result: Dictionary = {}

	if _item:
		result[KEY_ITEM] = _item.serialize()

	return result


## Loads the item slot data from the given dictionary.
## @note: If the slot contains an item prior to deserialization, it will be queued for deletion.
func deserialize(source: Dictionary) -> bool:
	if !Verify.dict(source, false, KEY_ITEM, [TYPE_DICTIONARY]):
		return false

	reset()

	if source.has(KEY_ITEM):
		var item := InventoryItem.new()
		if !item.deserialize(source[KEY_ITEM]):
			return false
		equip(item)

	return true
