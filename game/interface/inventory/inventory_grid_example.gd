extends Control

const INFO_OFFSET := Vector2(20, 0)

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

var user_items: Array[Dictionary]= [
	{
		"id": "other_book_blue",
		"amount": 2,
		"position": Vector2i(3, 3)
	},
 {
		"id": "armor_chestplate_silver",
		"amount": 1,
		"position": Vector2i(4, 4)
	},
]

var npc_items: Array[Dictionary]= [
	{
		"id": "other_book_blue",
		"amount": 2,
		"position": Vector2i(3, 3)
	}
]


func populate_inventory_grid(inventory: InventoryGrid, items: Array[Dictionary]) -> void:
	for item: Dictionary in items:
		inventory.create_and_add_item_at(item["id"], item["position"], item["amount"])

func add_item_definition_if_needed(id: String, array: Array[BaseItemModel]) -> void:
	if array.any(func(item: BaseItemModel)-> bool: return item.id == id):
		return
	array.append(ItemManager.get_item(id))

func _populate_inventory() -> void:
	# First generate a protoset for inventory_player_grid and inventory_npc_grid that has only
	# the item_definitions needed for the user and npc inventories
	var item_definitions_needed: Array[BaseItemModel] = []


	for item: Dictionary in (user_items + npc_items):
		add_item_definition_if_needed(item["id"], item_definitions_needed)

	var item_protoset: InventoryItemProtoset = InventoryItemProtoset.new()
	item_protoset.parse_prototypes(item_definitions_needed)

	inventory_player_grid.inventory.item_protoset = item_protoset
	inventory_npc_grid.inventory.item_protoset = item_protoset
	inventory_player_grid.inventory.enable_weight_constraint(5.0)
	equipeped_item_slot.item_protoset = item_protoset

	populate_inventory_grid(inventory_player_grid.inventory, user_items)
	populate_inventory_grid(inventory_npc_grid.inventory, npc_items)

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
	print("Save button pressed")
	print(inventory_player_grid.inventory.get_item_at(Vector2i(3, 3)))

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
