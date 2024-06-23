class_name ItemManager

const ITEM_PROVIDERS := {
	"weapon": "res://core/items/weapons/melee_weapons.gd",
	"armor": "res://core/items/armor/armor.gd",
	"consumable": "res://core/items/consumables/consumable_items.gd",
	"other": "res://core/items/other/other_items.gd"
}

static var _providers: Dictionary = {}

# Cache for instantiated NPCs
static var items_cache: Dictionary


static func get_item(item_id: String) -> BaseItemModel:
	if items_cache and items_cache.has(item_id):
		return items_cache[item_id]

	var provider_type := item_id.split("_")[0]
	var provider := _get_provider(provider_type)
	assert(provider, "Invalid item id: %s" % item_id)
	var item := provider.get_item(item_id)

	if items_cache:
		items_cache[item_id] = item
	else:
		items_cache = {item_id: item}
	return item

static func _get_provider(provider_type: String) -> BaseItemRepository:
	if _providers.has(provider_type):
		return _providers[provider_type]
	_providers[provider_type] = _instantiate_provider(provider_type)
	return _providers[provider_type]

static func _instantiate_provider(provider_type: String) -> BaseItemRepository:
	var provider_path: String = ITEM_PROVIDERS[provider_type]
	var resource := load(provider_path)
	return resource.new()