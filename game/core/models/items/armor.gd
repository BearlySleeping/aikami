class_name ArmorModel
extends EquipableItemModel


func _init(id: String, data: Dictionary) -> void:
	super(id, data)


func to_dict() -> Dictionary:
	var dict := super()
	return dict
