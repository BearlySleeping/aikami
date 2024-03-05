extends BaseItemRepository

const ITEMS: Dictionary = {
	"armor_helmet_iron":
	{
		"name": "Iron Helmet",
		"description": "A small dagger made of iron",
		"cost": 5,
	}
}


func get_item(item_id: String) -> ArmorModel:
	return ArmorModel.new(item_id, _get_item_from_dict(item_id, ITEMS))
