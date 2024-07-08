extends BaseItemRepository

const ITEMS: Dictionary = {
	"other_book_blue":
	{
		"name": "Blue Book",
		"description": "A small book made of blue",
		"cost": 5,
		"image_path": "res://interface/inventory/item_book_blue.png",
		"weight": 0,
		"max_stack_size": 2
	}
}


func get_item(item_id: String) -> OtherItemModel:
	return OtherItemModel.new(item_id, _get_item_from_dict(item_id, ITEMS))
