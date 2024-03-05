extends BaseItemRepository

const ITEMS: Dictionary = {
	"consumable_potion_health_big":
	{
		"name": "Big Health Potion",
		"description": "A small dagger made of iron",
		"cost": 5,
	}
}


func get_item(item_id: String) -> ConsumableItemModel:
	return ConsumableItemModel.new(item_id, _get_item_from_dict(item_id, ITEMS))
