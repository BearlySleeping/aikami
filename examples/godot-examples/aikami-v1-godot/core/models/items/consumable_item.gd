class_name ConsumableItemModel
extends BaseItemModel


func _init(p_id: String, data: Dictionary) -> void:
	super(p_id, data)


func to_dict() -> Dictionary:
	var dict := super()
	return dict
