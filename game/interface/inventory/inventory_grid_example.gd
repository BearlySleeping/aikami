extends Control

const INFO_OFFSET := Vector2(20, 0)
const USER_INVENTORY_SAVE_FILE: String = "test_user_inventory_state.save"
const USER_EQUIPPED_SAVE_FILE: String = "test_user_equipped_state.save"
const NPC_INVENTORY_SAVE_FILE: String = "test_npc_inventory_state.save"

@onready var inventory_player_grid: InventoryControlGrid = %InventoryGridPlayerControl
@onready var inventory_npc_grid: InventoryControlGrid = %InventoryGridNpcControl
@onready var sort_player_button: Button = %SortPlayerButton
@onready var sort_npc_button: Button = %SortNpcButton
@onready var split_player_button: Button = %SplitPlayerButton
@onready var split_npc_button: Button = %SplitNpcButton
@onready var lbl_info: Label = %InfoLabel
@onready var save_button: Button = %SaveButton

var equipped_slots: Array[InventoryItemSlot] = []


func add_item_definition_if_needed(id: String, array: Array[BaseItemModel]) -> void:
	if array.any(func(item: BaseItemModel) -> bool: return item.id == id):
		return
	array.append(ItemManager.get_item(id))


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
				{"id": "other_book_blue", "amount": 2, "position": Vector2i(3, 3)}
			),
			InventoryItemModel.new(
				{"id": "armor_chestplate_silver", "amount": 1, "position": Vector2i(4, 4)}
			),
		]
	)
	var npc_items := load_inventory_data(
		NPC_INVENTORY_SAVE_FILE,
		[
			InventoryItemModel.new(
				{"id": "other_book_blue", "amount": 2, "position": Vector2i(3, 3)}
			),
		]
	)

	var equipped_items := load_inventory_data(USER_EQUIPPED_SAVE_FILE, [])

	# First generate a protoset for inventory_player_grid and inventory_npc_grid that has only
	# the item_definitions needed for the user and npc inventories
	var item_definitions_needed: Array[BaseItemModel] = []

	for item: InventoryItemModel in user_items + npc_items + equipped_items:
		add_item_definition_if_needed(item["id"], item_definitions_needed)

	var item_protoset: InventoryItemProtoset = InventoryItemProtoset.new(item_definitions_needed)
	inventory_player_grid.inventory = InventoryGridStacked.new()
	inventory_npc_grid.inventory = InventoryGridStacked.new()
	inventory_player_grid.inventory.item_protoset = item_protoset
	inventory_npc_grid.inventory.item_protoset = item_protoset
	inventory_player_grid.inventory.enable_weight_constraint(5.0)
	inventory_player_grid.populate_inventory(user_items)
	inventory_npc_grid.populate_inventory(npc_items)

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
		item_slot.item_protoset = item_protoset
		equipped_item_slot.item_slot = item_slot
		equipped_item_slot.slot_type = slot_type

		_find_and_equip_item(
			equipped_items, item_definitions_needed, slot_type, item_slot, item_protoset
		)

		equipped_item_slot_container.add_child(equipped_item_slot)
		equipped_slots.append(item_slot)


## Finds and equips the item for the given slot type
func _find_and_equip_item(
	equipped_items: Array[InventoryItemModel],
	item_definitions_needed: Array[BaseItemModel],
	slot_type: Enum.EquippedSlotType,
	item_slot: InventoryItemSlot,
	item_protoset: InventoryItemProtoset
) -> bool:
	for equipped_item in equipped_items:
		var item_definition_index := -1
		for i in range(item_definitions_needed.size()):
			if item_definitions_needed[i].id == equipped_item.id:
				item_definition_index = i
				break
		if item_definition_index == -1:
			continue
		if item_definitions_needed[item_definition_index].slot_type != slot_type:
			continue

		item_slot.equip(
			InterfaceInventoryItem.new(
				equipped_item, item_protoset, inventory_player_grid.inventory
			)
		)
		return true
	return false


func _ready() -> void:
	inventory_player_grid.item_mouse_entered.connect(_on_item_mouse_entered)
	inventory_player_grid.item_mouse_exited.connect(_on_item_mouse_exited)
	inventory_npc_grid.item_mouse_entered.connect(_on_item_mouse_entered)
	inventory_npc_grid.item_mouse_exited.connect(_on_item_mouse_exited)
	sort_player_button.pressed.connect(_on_btn_sort.bind(inventory_player_grid))
	sort_npc_button.pressed.connect(_on_btn_sort.bind(inventory_npc_grid))
	split_player_button.pressed.connect(_on_btn_split.bind(inventory_player_grid))
	split_npc_button.pressed.connect(_on_btn_split.bind(inventory_npc_grid))
	save_button.pressed.connect(_on_save_button_pressed)
	_populate_inventory()


func _on_save_button_pressed() -> void:
	var user_items := inventory_player_grid.get_inventory_items()
	print("save user_items:", user_items)
	SaveManager.save_file_raw(
		USER_INVENTORY_SAVE_FILE,
		user_items.map(func(item: InventoryItemModel) -> Dictionary: return item.to_dict())
	)

	var npc_items := inventory_npc_grid.get_inventory_items()
	print("save npc_items:", npc_items)
	SaveManager.save_file_raw(
		NPC_INVENTORY_SAVE_FILE,
		npc_items.map(func(item: InventoryItemModel) -> Dictionary: return item.to_dict())
	)
#
	var equipped_items: Array[InventoryItemModel] = []

	for slot: InventoryItemSlot in equipped_slots:
		var item := slot.get_item()
		if item != null:
			equipped_items.append(item.item)

	print("equipped_items:", equipped_items)

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
