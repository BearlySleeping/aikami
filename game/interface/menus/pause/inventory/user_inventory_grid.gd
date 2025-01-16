extends Control

const INFO_OFFSET := Vector2(20, 0)
const USER_INVENTORY_SAVE_FILE := "user_inventory_state.save"
const USER_EQUIPPED_SAVE_FILE := "user_equipped_state.save"

var equipped_slots: Array[InventoryItemSlot] = []

@onready var inventory_player_grid: InventoryControlGrid = %InventoryGridPlayerControl
@onready var sort_player_button: Button = %SortPlayerButton
@onready var split_player_button: Button = %SplitPlayerButton
@onready var lbl_info: Label = %InfoLabel


func load_inventory_data(
	save_path: String, default_items: Array[InventoryItemModel]
) -> Array[InventoryItemModel]:
	var response := SaveManager.load_file(save_path)
	if response[0] == null:
		return default_items
	var data := response[0] as Array
	var items: Array[InventoryItemModel] = []
	for item: Dictionary in data:
		items.append(InventoryItemModel.new(item))
	return items


func _populate_inventory() -> void:
	var user_items := load_inventory_data(
		USER_INVENTORY_SAVE_FILE,
		[
			InventoryItemModel.new(
				{"id": "other_book_blue", "stack_size": 2, "grid_position": Vector2i(3, 3)}
			),
			InventoryItemModel.new(
				{"id": "armor_chestplate_silver", "stack_size": 1, "grid_position": Vector2i(4, 4)}
			),
		]
	)

	var equipped_items := load_inventory_data(USER_EQUIPPED_SAVE_FILE, [])

	inventory_player_grid.inventory = InventoryGridStacked.new()
	inventory_player_grid.inventory.enable_weight_constraint(5.0)
	inventory_player_grid.populate_inventory(user_items)

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
			equipped_items,
			slot_type,
			item_slot,
		)

		equipped_item_slot_container.add_child(equipped_item_slot)
		equipped_slots.append(item_slot)
		item_slot.item_equipped.connect(_save)
		item_slot.cleared.connect(_save)


## Finds and equips the item for the given slot type
func _find_and_equip_item(
	equipped_items: Array[InventoryItemModel],
	slot_type: Enum.EquippedSlotType,
	item_slot: InventoryItemSlot,
) -> bool:
	for equipped_item in equipped_items:
		var item_data := ItemManager.get_item(equipped_item.id)
		if item_data.slot_type != slot_type:
			continue

		item_slot.equip(InterfaceInventoryItem.new(equipped_item, inventory_player_grid.inventory))
		return true
	return false


func _ready() -> void:
	inventory_player_grid.item_mouse_entered.connect(_on_item_mouse_entered)
	inventory_player_grid.item_mouse_exited.connect(_on_item_mouse_exited)
	sort_player_button.pressed.connect(_on_btn_sort.bind(inventory_player_grid))
	split_player_button.pressed.connect(_on_btn_split.bind(inventory_player_grid))
	_populate_inventory()
	inventory_player_grid.inventory.contents_changed.connect(_save)


func _save() -> void:
	var user_items := inventory_player_grid.get_inventory_items()
	print("save user_items:", user_items)
	SaveManager.save_file_raw(
		USER_INVENTORY_SAVE_FILE,
		user_items.map(func(item: InventoryItemModel) -> Dictionary: return item.to_dict())
	)

	var equipped_items: Array[InventoryItemModel] = []
	var player_equipment: Dictionary = {}

	for slot: InventoryItemSlot in equipped_slots:
		var item := slot.get_item()
		if item != null:
			equipped_items.append(item.item_data)
			player_equipment[slot.slot_type] = item.prototype_id

	print("equipped_items:", equipped_items)

	PlayerManager.set_equipments(player_equipment)

	SaveManager.save_file_raw(
		USER_EQUIPPED_SAVE_FILE,
		equipped_items.map(func(item: InventoryItemModel) -> Dictionary: return item.to_dict())
	)


func _on_item_mouse_entered(item: InterfaceInventoryItem) -> void:
	lbl_info.show()
	lbl_info.text = item.get_title()


func _on_item_mouse_exited(_item: InterfaceInventoryItem) -> void:
	lbl_info.hide()


func _input(event: InputEvent) -> void:
	if !(event is InputEventMouseMotion):
		return

	lbl_info.set_global_position(get_global_mouse_position() + INFO_OFFSET)


func _on_btn_sort(ctrl_inventory: InventoryControlGrid) -> void:
	if !ctrl_inventory.inventory.sort():
		print("Warning: InventoryGrid.sort() returned false!")


func _on_btn_split(ctrl_inventory: InventoryControlGrid) -> void:
	var inventory_stacked := ctrl_inventory.inventory as InventoryGridStacked
	if inventory_stacked == null:
		print("Warning: inventory is not InventoryGridStacked!")
		return

	var selected_item := ctrl_inventory.get_selected_inventory_item()
	if selected_item == null:
		return

	var stack_size := InventoryGridStacked.get_item_stack_size(selected_item)
	if stack_size < 2:
		return

	# All this floor/float jazz just to do integer division without warnings
	var new_stack_size: int = floor(float(stack_size) / 2)
	inventory_stacked.split(selected_item, new_stack_size)
