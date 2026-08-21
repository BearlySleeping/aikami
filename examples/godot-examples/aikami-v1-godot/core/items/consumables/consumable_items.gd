extends BaseItemRepository

const ITEMS: Dictionary = {
	"consumable_potion_health_small":
	{
		"name": "Small Health Potion",
		"description": "A small health potion",
		"cost": 10,
		"height": 1,
		"image_path": "res://interface/inventory/item_armour_silver.png",
		"width": 1,
		"weight": 1
	},
}


func get_item(item_id: String) -> ConsumableItemModel:
	return ConsumableItemModel.new(item_id, _get_item_from_dict(item_id, ITEMS))
