@tool
class_name InterBBBBBfaceInventoryItem
extends Node

## Inventory item class.
## Can hold additional properties.

## Emitted when the item prototype ID changes.
signal prototype_id_changed
## Emitted when the item properties change.
signal properties_changed
signal added_to_inventory(inventory: Inventory)
signal removed_from_inventory(inventory: Inventory)
signal equipped_in_slot(item_slot: InventoryItemSlot)
signal removed_from_slot(item_slot: InventoryItemSlot)

const KEY_PROTOTYPE_ID := "prototype_id"
const KEY_PROPERTIES := "properties"
const KEY_NODE_NAME := "node_name"
const KEY_TYPE := "type"
const KEY_VALUE := "value"

const KEY_IMAGE := "image_path"
const KEY_NAME := "name"

const Verify := preload("../constraints/inventory_verify.gd")

var _item: InventoryItemModel


func _init(
	item: InventoryItemModel,
	inventory: Inventory,
) -> void:
	_item = item
	_inventory = inventory


## ID of the prototype from protoset this item is based on.
## @required
var prototype_id: String:
	get:
		return _item.id

var stack_size: int:
	get:
		return _item.stack_size
	set(new_stack_size):
		_item.stack_size = new_stack_size
		properties_changed.emit()

var grid_position: Vector2i:
	get:
		return _item.grid_position
	set(new_grid_position):
		_item.grid_position = new_grid_position
		properties_changed.emit()

var item_data: InventoryItemModel:
	get:
		return _item

var _inventory: Inventory
var _item_slot: InventoryItemSlot


func get_metadata() -> BaseItemModel:
	return ItemManager.get_item(prototype_id)


func _notification(what: int) -> void:
	if what == NOTIFICATION_PARENTED:
		_on_parented(get_parent())
	elif what == NOTIFICATION_UNPARENTED:
		_on_unparented()


func _on_parented(parent: Node) -> void:
	if parent is Inventory:
		_on_added_to_inventory(parent as Inventory)
	else:
		_inventory = null

	if parent is InventoryItemSlot:
		_link_to_slot(parent as InventoryItemSlot)
	else:
		_unlink_from_slot()


func _on_added_to_inventory(inventory: Inventory) -> void:
	assert(inventory)
	_inventory = inventory
	added_to_inventory.emit(_inventory)
	_inventory.on_item_added(self)


func _on_unparented() -> void:
	if _inventory:
		_on_removed_from_inventory(_inventory)
	_inventory = null

	_unlink_from_slot()


func _on_removed_from_inventory(inventory: Inventory) -> void:
	if inventory:
		removed_from_inventory.emit(inventory)
		inventory.on_item_removed(self)


func _link_to_slot(item_slot: InventoryItemSlot) -> void:
	_item_slot = item_slot
	_item_slot.on_item_added(self)
	equipped_in_slot.emit(item_slot)


func _unlink_from_slot() -> void:
	if _item_slot == null:
		return
	var temp_slot := _item_slot
	_item_slot = null
	temp_slot.on_item_removed()
	removed_from_slot.emit(temp_slot)


## Returns the Inventory this item belongs to.
func get_inventory() -> Inventory:
	return _inventory


## Resets all properties to default values.
func reset() -> void:
	prototype_id = ""


## Helper function for retrieving the item texture.
## It checks the image item property and loads it as a texture, if available.
func get_texture() -> Texture2D:
	var texture_path := get_metadata().image_path
	if texture_path && texture_path != "" && ResourceLoader.exists(texture_path):
		var texture := load(texture_path)
		if texture is Texture2D:
			return texture
	return null


## Helper function for retrieving the item title.
## It checks the name item property and uses it as the title.
func get_title() -> String:
	var title: String = get_metadata().name

	return title


##  Serializes the item into a dictionary.
func serialize() -> Dictionary:
	var result: Dictionary = {}

	result[KEY_NODE_NAME] = name as String
	result[KEY_PROTOTYPE_ID] = prototype_id
	var properties := item_data.to_dict()
	if !properties.is_empty():
		result[KEY_PROPERTIES] = {}
		for property_name: String in properties.keys():
			result[KEY_PROPERTIES][property_name] = _serialize_property(property_name)

	return result


func _serialize_property(property_name: String) -> Dictionary:
	# Store all properties as strings for JSON support.
	var result: Dictionary = {}
	var properties := item_data.to_dict()
	var property_value: Variant = properties[property_name]
	var property_type := typeof(property_value)
	result = {KEY_TYPE: property_type, KEY_VALUE: var_to_str(property_value)}
	return result


## Deserializes the item from a given dictionary.
func deserialize(source: Dictionary) -> bool:
	if (
		!Verify.dict(source, true, KEY_NODE_NAME, TYPE_STRING)
		|| !Verify.dict(source, true, KEY_PROTOTYPE_ID, TYPE_STRING)
		|| !Verify.dict(source, false, KEY_PROPERTIES, TYPE_DICTIONARY)
	):
		return false

	reset()

	if !source[KEY_NODE_NAME].is_empty() && source[KEY_NODE_NAME] != name:
		name = source[KEY_NODE_NAME]
	prototype_id = source[KEY_PROTOTYPE_ID]
	var properties := {}
	if source.has(KEY_PROPERTIES):
		for key: String in source[KEY_PROPERTIES].keys():
			properties[key] = _deserialize_property(source[KEY_PROPERTIES][key])
			if properties[key] == null:
				properties = {}
				return false
	_item = InventoryItemModel.new(properties)
	return true


func _deserialize_property(data: Dictionary) -> Variant:
	# Properties are stored as strings for JSON support.
	var result: Variant = str_to_var(data[KEY_VALUE])
	var expected_type: int = data[KEY_TYPE]
	var property_type: int = typeof(result)
	if property_type != expected_type:
		print(
			(
				"Property has unexpected type: %s. Expected: %s"
				% [Verify.TYPE_NAMES[property_type], Verify.TYPE_NAMES[expected_type]]
			)
		)
		return
	return result
