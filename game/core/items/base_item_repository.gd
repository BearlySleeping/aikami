class_name BaseItemRepository


func get_item(item_id: String) -> BaseItemModel:
	assert(false, "Not implemented")
	return BaseItemModel.new(item_id, {})


func _get_item_from_dict(item_id: String, items: Dictionary) -> Dictionary:
	var item: Dictionary = items[item_id]
	assert(item, "%s is not a valid item id" % item_id)
	return item
