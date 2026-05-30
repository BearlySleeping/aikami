extends BaseItemRepository

const ITEMS: Dictionary = {
	"weapon_melee_iron_dagger":
	{
		"name": "Iron Dagger",
		"description": "A small dagger made of iron",
		"damage": 5,
		"cost": 5,
	}
}


func get_item(item_id: String) -> WeaponModel:
	return WeaponModel.new(item_id, _get_item_from_dict(item_id, ITEMS))
