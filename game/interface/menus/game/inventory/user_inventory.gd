extends Control

const INFO_OFFSET := Vector2(20, 0)
const USER_INVENTORY_SAVE_FILE := "user_inventory_state.save"

@onready var inventory_player_grid: InventoryControlGrid = %InventoryGridPlayerControl
@onready var sort_player_button: Button = %SortPlayerButton
@onready var split_player_button: Button = %SplitPlayerButton
@onready var lbl_info: Label = %InfoLabel
@onready var user_equipment_bar: VBoxContainer = %UserEquipmentBar


func _populate_inventory() -> void:
	var user_inventory := (
		SaveManager
		. load_items(
			USER_INVENTORY_SAVE_FILE,
			[
				InventoryItemModel.new(
					{"id": "other_book_blue", "stack_size": 2, "grid_position": Vector2i(3, 3)}
				),
				InventoryItemModel.new(
					{
						"id": "armor_chestplate_silver",
						"stack_size": 1,
						"grid_position": Vector2i(4, 4)
					}
				),
			]
		)
	)

	inventory_player_grid.inventory = InventoryGridStacked.new()
	inventory_player_grid.inventory.enable_weight_constraint(5.0)
	inventory_player_grid.populate_inventory(user_inventory)


func _ready() -> void:
	inventory_player_grid.item_mouse_entered.connect(_on_item_mouse_entered)
	inventory_player_grid.item_mouse_exited.connect(_on_item_mouse_exited)
	sort_player_button.pressed.connect(_on_btn_sort.bind(inventory_player_grid))
	split_player_button.pressed.connect(_on_btn_split.bind(inventory_player_grid))
	_populate_inventory()


func _save_inventory() -> void:
	var user_inventory := inventory_player_grid.get_inventory_items()
	print("save user_inventory:", user_inventory)
	SaveManager.save_file_raw(
		USER_INVENTORY_SAVE_FILE,
		user_inventory.map(func(item: InventoryItemModel) -> Dictionary: return item.to_dict())
	)
	user_equipment_bar.save_equipment()


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


func _on_hidden() -> void:
	_save_inventory()
