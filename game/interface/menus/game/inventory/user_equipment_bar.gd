extends VBoxContainer

const USER_EQUIPPED_SAVE_FILE := "user_equipped_state.save"

@export var inventory_player_grid: InventoryControlGrid

var equipped_slots: Array[InventoryItemSlot] = []


func _populate_equipment() -> void:
	var user_equipment := SaveManager.load_items(USER_EQUIPPED_SAVE_FILE)
	var slot_types: Array = Enum.EquippedSlotType.values()
	for slot_type: Enum.EquippedSlotType in slot_types:
		if slot_type == Enum.EquippedSlotType.NONE:
			continue
		var slot_name: String = Enum.EquippedSlotType.keys()[slot_type]
		var node_name: String = "%" + Utils.capitalize_first_letter(slot_name) + "SlotContainer"
		var equipped_item_slot_container: PanelContainer = get_node(node_name)
		var equipped_item_slot: InventoryControlItemSlot = InventoryControlItemSlot.new()
		var item_slot: InventoryItemSlot = InventoryItemSlot.new()
		item_slot.slot_type = slot_type
		equipped_item_slot.item_slot = item_slot
		equipped_item_slot.slot_type = slot_type

		_find_and_equip_item(
			user_equipment,
			slot_type,
			item_slot,
		)

		equipped_item_slot_container.add_child(equipped_item_slot)
		equipped_slots.append(item_slot)


## Finds and equips the item for the given slot type
func _find_and_equip_item(
	user_equipment: Array[InventoryItemModel],
	slot_type: Enum.EquippedSlotType,
	item_slot: InventoryItemSlot,
) -> bool:
	for equipped_item in user_equipment:
		var item_data := ItemManager.get_item(equipped_item.id)
		if item_data.slot_type != slot_type:
			continue

		item_slot.equip(InterfaceInventoryItem.new(equipped_item, inventory_player_grid.inventory))
		return true
	return false


func _ready() -> void:
	_populate_equipment()


func save_equipment() -> void:
	var user_equipment: Array[InventoryItemModel] = []

	for slot: InventoryItemSlot in equipped_slots:
		var item := slot.get_item()
		if item != null:
			user_equipment.append(item.item_data)

	SaveManager.save_file_raw(
		USER_EQUIPPED_SAVE_FILE,
		user_equipment.map(func(item: InventoryItemModel) -> Dictionary: return item.to_dict())
	)
