extends BaseItemRepository

const ITEMS: Dictionary = {
	"armor_chestplate_silver":
	{
		"name": "Silver Chestplate",
		"description": "A chestplate made of silver",
		"cost": 10,
		"height": 2,
		"image_path": "res://interface/inventory/item_armour_silver.png",
		"width": 2,
		"weight": 3
	},
}


func get_item(item_id: String) -> ArmorModel:
	return ArmorModel.new(item_id, _get_item_from_dict(item_id, ITEMS))
