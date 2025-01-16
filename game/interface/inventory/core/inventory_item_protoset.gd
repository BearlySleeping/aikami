@tool
class_name InventoryItemProtoset
extends Resource

## A resource type holding a set of inventory item prototypes in JSON format.

const KEY_ID := "id"

var _prototypes: Array[BaseItemModel] = []


func _init(prototypes: Array[BaseItemModel]) -> void:
	_prototypes = prototypes


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


func _save() -> void:
	emit_changed()
	if !resource_path.is_empty():
		ResourceSaver.save(self)


## Returns the prototype with the given ID.
func get_prototype(id: StringName) -> BaseItemModel:
	for item in _prototypes:
		if item.id == id:
			return item
	assert(false, "No prototype with ID: %s" % id)
	return null  # This line is never reached due to the assert


func get_prototype_dict(id: StringName) -> Dictionary:
	return get_prototype(id).to_dict()


func has_prototype(id: String) -> bool:
	return _prototypes.any(func(item: BaseItemModel) -> bool: return item.id == id)


## Returns the value of the property with the given name from the prototype with the given ID.
## In case the value can not be found, the default value is returned.
func get_prototype_property(
	id: String, property_name: String, default_value: Variant = null
) -> Variant:
	if !has_prototype(id):
		return default_value

	var prototype: Dictionary = get_prototype_dict(id)
	if !prototype.has(property_name):
		return default_value

	return prototype[property_name]


## Checks if the given item prototype has the given property.
func prototype_has_property(id: String, property_name: String) -> bool:
	if has_prototype(id):
		return get_prototype_dict(id).has(property_name)

	return false
