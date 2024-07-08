class_name OtherItemModel
extends BaseItemModel


func _init(p_id: String, data: Dictionary) -> void:
	super(p_id, data)


func to_dict() -> Dictionary:
	var dict := super()
	return dict
