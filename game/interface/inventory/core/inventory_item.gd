@tool
class_name InterfaceInventoryItem
extends Node

## Inventory item class. It is based on an item prototype from an InventoryItemProtoset resource.
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

## ID of the prototype from protoset this item is based on.
## @required
var prototype_id: String:
	get:
		return _item_item_data.id

## Additional item properties.
## @optional
var properties: Dictionary:
	set(new_properties):
		_item_item_data = InventoryItemModel.new(new_properties)
		properties_changed.emit()
		update_configuration_warnings()
	get:
		return _item_item_data.to_dict()

var stack_size: int:
	get:
		return _item_item_data.stack_size
	set(new_stack_size):
		_item_item_data.stack_size = new_stack_size
		properties_changed.emit()

var grid_position: Vector2i:
	get:
		return _item_item_data.grid_position
	set(new_grid_position):
		_item_item_data.grid_position = new_grid_position
		properties_changed.emit()

var item_data: InventoryItemModel:
	get:
		return _item_item_data

var _item_item_data: InventoryItemModel
var _inventory: Inventory
var _item_slot: InventoryItemSlot


func _init(
	item: InventoryItemModel,
	inventory: Inventory,
) -> void:
	_item_item_data = item
	_inventory = inventory


func get_metadata() -> BaseItemModel:
	return ItemManager.get_item(prototype_id)


func _reset_properties() -> void:
	_item_item_data = (
		InventoryItemModel
		. new(
			{
				"id": prototype_id,
			}
		)
	)


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


## Returns the value of the property with the given name.
## In case the property can not be found, the default value is returned.
func get_property(property_name: String, default_value: Variant = null) -> Variant:
	# Note: The protoset editor still doesn't support arrays and dictionaries,
	# but those can still be added via JSON definitions or via code.
	if properties.has(property_name):
		var value: Variant = properties[property_name]
		if typeof(value) == TYPE_DICTIONARY || typeof(value) == TYPE_ARRAY:
			return value.duplicate()
		return value
	var metadata: Dictionary = get_metadata().to_dict()
	if metadata.has(property_name):
		var value: Variant = metadata[property_name]
		if typeof(value) == TYPE_DICTIONARY || typeof(value) == TYPE_ARRAY:
			return value.duplicate()
		return value

	return default_value


##  Sets the property with the given name for this item.
func set_property(property_name: String, value: Variant) -> void:
	var old_property: Variant = null
	if properties.has(property_name):
		old_property = properties[property_name]
	properties[property_name] = value
	if old_property != properties[property_name]:
		properties_changed.emit()


## Clears the property with the given name for this item.
func clear_property(property_name: String) -> void:
	if properties.has(property_name):
		properties.erase(property_name)
		properties_changed.emit()


## Resets all properties to default values.
func reset() -> void:
	prototype_id = ""
	properties = {}


##  Serializes the item into a dictionary.
func serialize() -> Dictionary:
	var result: Dictionary = {}

	result[KEY_NODE_NAME] = name as String
	result[KEY_PROTOTYPE_ID] = prototype_id
	if !properties.is_empty():
		result[KEY_PROPERTIES] = {}
		for property_name: String in properties.keys():
			result[KEY_PROPERTIES][property_name] = _serialize_property(property_name)

	return result


func _serialize_property(property_name: String) -> Dictionary:
	# Store all properties as strings for JSON support.
	var result: Dictionary = {}
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
	if source.has(KEY_PROPERTIES):
		for key: String in source[KEY_PROPERTIES].keys():
			properties[key] = _deserialize_property(source[KEY_PROPERTIES][key])
			if properties[key] == null:
				properties = {}
				return false

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


## Helper function for retrieving the item texture.
## It checks the image item property and loads it as a texture, if available.
func get_texture() -> Texture2D:
	var texture_path: Variant = get_property(KEY_IMAGE)
	if texture_path && texture_path != "" && ResourceLoader.exists(texture_path):
		var texture := load(texture_path)
		if texture is Texture2D:
			return texture
	return null


## Helper function for retrieving the item title.
## It checks the name item property and uses it as the title.
func get_title() -> String:
	var title: String = get_property(KEY_NAME, prototype_id)

	return title
