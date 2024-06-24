extends Control

const INFO_OFFSET := Vector2(20, 0)
const USER_INVENTORY_SAVE_FILE: String = "test_user_inventory_state.save"
const NPC_INVENTORY_SAVE_FILE: String = "test_npc_inventory_state.save"

@onready var inventory_player_grid: InventoryControlGrid = %CtrlInventoryGridLeft
@onready var inventory_npc_grid: InventoryControlGrid = %CtrlInventoryGridRight
@onready var equipeped_item_slot: InventoryItemSlot = %ItemSlot
@onready var sort_player_button: Button = %BtnSortLeft
@onready var sort_npc_button: Button = %BtnSortRight
@onready var split_player_button: Button = %BtnSplitLeft
@onready var split_npc_button: Button = %BtnSplitRight
@onready var ctrl_slot: InventoryControlItemSlot = %CtrlItemSlot
@onready var btn_unequip: Button = %BtnUnequip
@onready var lbl_info: Label = %LblInfo
@onready var save_button: Button = %SaveButton


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
	# First generate a protoset for inventory_player_grid and inventory_npc_grid that has only
	# the item_definitions needed for the user and npc inventories
	var item_definitions_needed: Array[BaseItemModel] = []

	for item: InventoryItemModel in user_items + npc_items:
		add_item_definition_if_needed(item["id"], item_definitions_needed)

	var item_protoset: InventoryItemProtoset = InventoryItemProtoset.new()
	item_protoset.parse_prototypes(item_definitions_needed)

	inventory_player_grid.inventory.item_protoset = item_protoset
	inventory_npc_grid.inventory.item_protoset = item_protoset
	inventory_player_grid.inventory.enable_weight_constraint(5.0)
	equipeped_item_slot.item_protoset = item_protoset

	inventory_player_grid.populate_inventory(user_items)
	inventory_npc_grid.populate_inventory(npc_items)


func _ready() -> void:
	inventory_player_grid.item_mouse_entered.connect(_on_item_mouse_entered)
	inventory_player_grid.item_mouse_exited.connect(_on_item_mouse_exited)
	inventory_npc_grid.item_mouse_entered.connect(_on_item_mouse_entered)
	inventory_npc_grid.item_mouse_exited.connect(_on_item_mouse_exited)
	sort_player_button.pressed.connect(_on_btn_sort.bind(inventory_player_grid))
	sort_npc_button.pressed.connect(_on_btn_sort.bind(inventory_npc_grid))
	split_player_button.pressed.connect(_on_btn_split.bind(inventory_player_grid))
	split_npc_button.pressed.connect(_on_btn_split.bind(inventory_npc_grid))
	btn_unequip.pressed.connect(_on_btn_unequip)
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


func _on_item_mouse_entered(item: InventoryItem) -> void:
	lbl_info.show()
	lbl_info.text = item.get_title()


func _on_item_mouse_exited(_item: InventoryItem) -> void:
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


func _on_btn_unequip() -> void:
	ctrl_slot.item_slot.clear()
