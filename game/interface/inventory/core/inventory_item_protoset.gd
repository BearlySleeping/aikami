@tool
class_name InventoryItemProtoset
extends Resource

## A resource type holding a set of inventory item prototypes in JSON format.

const KEY_ID := "id"

## JSON string containing item prototypes.
## @required
@export_multiline var json_data: String:
	set(new_json_data):
		json_data = new_json_data
		_save()

var _prototypes := {}:
	set(new_prototypes):
		_prototypes = new_prototypes
		_update_json_data()
		_save()


## Parses the given array of dictionaries and generates a new prototypes dictionary.
func parse_prototypes(prototypes_array: Array[BaseItemModel]) -> void:
	_prototypes.clear()

	for prototype in prototypes_array:
		assert(prototype is BaseItemModel, "Each item prototype must be a BaseItemModel!")

		var id := prototype.id
		assert(!_prototypes.has(id), "Item prototype ID '%s' already in use!" % id)
		var prototype_data: Dictionary = prototype.to_item_prototype_dict()
		_prototypes[id] = prototype_data
		_unstringify_prototype(_prototypes[id])


func _to_json() -> String:
	var result: Array[Dictionary] = []
	for prototype_id: String in _prototypes.keys():
		result.append(get_prototype(prototype_id))

	for prototype in result:
		_stringify_prototype(prototype)

	# TODO: Add plugin settings for this
	return JSON.stringify(result, "    ")


func _stringify_prototype(prototype: Dictionary) -> void:
	for key: String in prototype.keys():
		var type := typeof(prototype[key])
		if (type != TYPE_STRING) and (type != TYPE_FLOAT):
			prototype[key] = var_to_str(prototype[key])


func _unstringify_prototype(prototype: Dictionary) -> void:
	for key: String in prototype.keys():
		var type := typeof(prototype[key])
		if type == TYPE_STRING:
			var variant: Variant = str_to_var(prototype[key])
			if variant:
				prototype[key] = variant


func _update_json_data() -> void:
	json_data = _to_json()


func _save() -> void:
	emit_changed()
	if !resource_path.is_empty():
		ResourceSaver.save(self)


## Returns the prototype with the given ID.
func get_prototype(id: StringName) -> Dictionary:
	assert(has_prototype(id), "No prototype with ID: %s" % id)
	return _prototypes[id]


##  Adds a prototype with the given ID.
func add_prototype(id: String) -> void:
	assert(!has_prototype(id), "Prototype with ID already exists")
	_prototypes[id] = {KEY_ID: id}
	_update_json_data()
	_save()


## Removes the prototype with the given ID.
func remove_prototype(id: String) -> void:
	assert(has_prototype(id), "No prototype with ID: %s" % id)
	_prototypes.erase(id)
	_update_json_data()
	_save()


## Duplicates the prototype with the given ID.
func duplicate_prototype(id: String) -> void:
	assert(has_prototype(id), "No prototype with ID: %s" % id)
	var new_id := "%s_duplicate" % id
	var new_dict: Variant = _prototypes[id].duplicate()
	new_dict[KEY_ID] = new_id
	_prototypes[new_id] = new_dict
	_update_json_data()
	_save()


## Renames the prototype with the given ID to a new ID.
func rename_prototype(id: String, new_id: String) -> void:
	assert(has_prototype(id), "No prototype with ID: %s" % id)
	assert(!has_prototype(new_id), "Prototype with ID already exists")
	add_prototype(new_id)
	_prototypes[new_id] = _prototypes[id].duplicate()
	_prototypes[new_id][KEY_ID] = new_id
	remove_prototype(id)
	_update_json_data()
	_save()


func set_prototype_properties(id: String, new_properties: Dictionary) -> void:
	_prototypes[id] = new_properties
	_update_json_data()
	_save()


## Checks if a prototype with the given ID exists.
func has_prototype(id: String) -> bool:
	return _prototypes.has(id)


## Sets the property with the given value for the prototype with the given ID.
func set_prototype_property(id: String, property_name: String, value: Variant) -> void:
	assert(has_prototype(id), "No prototype with ID: %s" % id)
	var prototype := get_prototype(id)
	prototype[property_name] = value


## Returns the value of the property with the given name from the prototype with the given ID.
## In case the value can not be found, the default value is returned.
func get_prototype_property(
	id: String, property_name: String, default_value: Variant = null
) -> Variant:
	if has_prototype(id):
		var prototype := get_prototype(id)
		if !prototype.is_empty() && prototype.has(property_name):
			return prototype[property_name]

	return default_value


## Checks if the given item prototype has the given property.
func prototype_has_property(id: String, property_name: String) -> bool:
	if has_prototype(id):
		return get_prototype(id).has(property_name)

	return false
