class_name ItemManager

const ITEM_PROVIDERS := {
	"weapon": preload("res://core/items/weapons/melee_weapons.gd"),
	"armor": preload("res://core/items/armor/armor.gd"),
	"consumable": preload("res://core/items/consumables/consumable_items.gd"),
	"other": preload("res://core/items/other/other_items.gd")
}

# Cache for instantiated NPCs
static var items_cache: Dictionary


static func get_item(item_id: String) -> BaseItemModel:
	if items_cache and items_cache.has(item_id):
		return items_cache[item_id]

	var provider_type := item_id.split("_")[0]
	var provider: BaseItemRepository = ITEM_PROVIDERS[provider_type]
	assert(provider, "Invalid item id: %s" % item_id)
	var item := provider.get_item(item_id)

	if items_cache:
		items_cache[item_id] = item
	else:
		items_cache = {item_id: item}
	return item
