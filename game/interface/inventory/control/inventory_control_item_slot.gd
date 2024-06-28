@tool
class_name InventoryControlItemSlot
extends Control

## A UI control representing an inventory slot (ItemSlot).
## Displays the texture of the set item and its name.
## If not item is set, it displays the given default texture.

const DropZone := preload("inventory_control_drop_zone.gd")
const Draggable := preload("inventory_control_draggable.gd")

var slot_type: Enum.EquippedSlotType

## The default icon that will be used for items with no image property.
## @required
@export var default_item_icon: Texture2D:
	set(new_default_item_icon):
		if default_item_icon == new_default_item_icon:
			return
		default_item_icon = new_default_item_icon
		_refresh()

## Item icon scaling.
## @default Vector2.ONE
@export var icon_scaling := Vector2.ONE:
	set(new_icon_scaling):
		if icon_scaling == new_icon_scaling:
			return
		icon_scaling = new_icon_scaling
		if _ctrl_inventory_item && _ctrl_inventory_item.texture:
			_ctrl_inventory_item.custom_minimum_size = (
				_ctrl_inventory_item.texture.get_size() * icon_scaling
			)

## The item texture is displayed if set to true.
## @default true
@export var item_texture_visible := true:
	set(new_item_texture_visible):
		if item_texture_visible == new_item_texture_visible:
			return
		item_texture_visible = new_item_texture_visible
		if _ctrl_inventory_item:
			_ctrl_inventory_item.visible = item_texture_visible

## The item name label is displayed if set to true.
## @default true
@export var label_visible := true:
	set(new_label_visible):
		if label_visible == new_label_visible:
			return
		label_visible = new_label_visible
		if is_instance_valid(_label):
			_label.visible = label_visible

## Style of the slot background.
## @optional
@export var slot_style: StyleBox:
	set(new_slot_style):
		slot_style = new_slot_style
		_refresh()

## Style of the slot background when the mouse hovers over it.
## @optional
@export var slot_highlighted_style: StyleBox:
	set(new_slot_highlighted_style):
		slot_highlighted_style = new_slot_highlighted_style
		_refresh()

var item_slot: InventoryItemSlotBase:
	set(new_item_slot):
		if new_item_slot == item_slot:
			return

		_disconnect_item_slot_signals()
		item_slot = new_item_slot
		_connect_item_slot_signals()

		_refresh()

var _background_panel: Panel
var _hbox_container: HBoxContainer
var _ctrl_inventory_item: InventoryControlItem
var _label: Label
var _ctrl_drop_zone: DropZone


func _update_background() -> void:
	if !is_instance_valid(_background_panel):
		_background_panel = Panel.new()
		add_child(_background_panel)
		move_child(_background_panel, 0)

	_background_panel.size = size
	_background_panel.show()
	if slot_style:
		_set_panel_style(_background_panel, slot_style)
	else:
		_background_panel.hide()


func _set_panel_style(panel: Panel, style: StyleBox) -> void:
	panel.remove_theme_stylebox_override("panel")
	if style:
		panel.add_theme_stylebox_override("panel", style)


func _input(event: InputEvent) -> void:
	if event is InputEventMouseMotion:
		if get_global_rect().has_point(get_global_mouse_position()) && slot_highlighted_style:
			_set_panel_style(_background_panel, slot_highlighted_style)
			return

		if slot_style:
			_set_panel_style(_background_panel, slot_style)
		else:
			_background_panel.hide()


func _connect_item_slot_signals() -> void:
	if !is_instance_valid(item_slot):
		return

	if !item_slot.item_equipped.is_connected(_refresh):
		item_slot.item_equipped.connect(_refresh)
	if !item_slot.cleared.is_connected(_refresh):
		item_slot.cleared.connect(_refresh)


func _disconnect_item_slot_signals() -> void:
	if !is_instance_valid(item_slot):
		return

	if item_slot.item_equipped.is_connected(_refresh):
		item_slot.item_equipped.disconnect(_refresh)
	if item_slot.cleared.is_connected(_refresh):
		item_slot.cleared.disconnect(_refresh)


func _ready() -> void:
	if Engine.is_editor_hint():
		# Clean up, in case it is duplicated in the editor
		if is_instance_valid(_hbox_container):
			_hbox_container.queue_free()

	_hbox_container = HBoxContainer.new()
	_hbox_container.size_flags_horizontal = SIZE_EXPAND_FILL
	_hbox_container.size_flags_vertical = SIZE_EXPAND_FILL
	add_child(_hbox_container)
	_hbox_container.resized.connect(func() -> void: size = _hbox_container.size)

	_ctrl_inventory_item = InventoryControlItem.new()
	_ctrl_inventory_item.visible = item_texture_visible
	_ctrl_inventory_item.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	_ctrl_inventory_item.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	_ctrl_inventory_item.item_slot = item_slot
	_ctrl_inventory_item.resized.connect(_on_ctrl_inventory_item_resized)
	_hbox_container.add_child(_ctrl_inventory_item)

	_ctrl_drop_zone = DropZone.new()
	_ctrl_drop_zone.draggable_dropped.connect(_on_draggable_dropped)
	_ctrl_drop_zone.size = size
	resized.connect(func() -> void: _ctrl_drop_zone.size = size)
	_ctrl_drop_zone.mouse_entered.connect(_on_drop_zone_mouse_entered)
	_ctrl_drop_zone.mouse_exited.connect(_on_drop_zone_mouse_exited)
	Draggable.draggable_grabbed.connect(_on_any_draggable_grabbed)
	Draggable.draggable_dropped.connect(_on_any_draggable_dropped)
	add_child(_ctrl_drop_zone)
	_ctrl_drop_zone.deactivate()

	_label = Label.new()
	_label.visible = label_visible
	_hbox_container.add_child(_label)

	size = _hbox_container.size
	_hbox_container.resized.connect(func() -> void: size = _hbox_container.size)
	resized.connect(_on_resized)
	_refresh()


func _on_ctrl_inventory_item_resized() -> void:
	custom_minimum_size = _ctrl_inventory_item.size
	size = _ctrl_inventory_item.size


func _on_resized() -> void:
	if is_instance_valid(_background_panel):
		_background_panel.size = size


func _on_draggable_dropped(draggable: Draggable, _drop_position: Vector2) -> void:
	var item := (draggable as InventoryControlItem).item

	if !item:
		return
	if !is_instance_valid(item_slot):
		return

	if !item_slot.can_hold_item(item):
		return

	if item == item_slot.get_item():
		return

	item_slot.equip(item)


func _on_drop_zone_mouse_entered() -> void:
	if Draggable.grabbed_draggable == null:
		return
	var grabbed_ctrl := Draggable.grabbed_draggable as InventoryControlItem
	if grabbed_ctrl == null || grabbed_ctrl.texture == null:
		return
	InventoryControlItem.override_preview_size(grabbed_ctrl.texture.get_size() * icon_scaling)


func _on_drop_zone_mouse_exited() -> void:
	InventoryControlItem.restore_preview_size()


func _on_any_draggable_grabbed(_draggable: Draggable, _grab_position: Vector2) -> void:
	_ctrl_drop_zone.activate()


func _on_any_draggable_dropped(
	draggable: Draggable, zone: DropZone, _drop_position: Vector2
) -> void:
	_ctrl_drop_zone.deactivate()

	# Unequip from other slots
	if zone == _ctrl_drop_zone || zone == null:
		return
	var ctrl_inventory_item_rect := draggable as InventoryControlItem
	if ctrl_inventory_item_rect.item_slot:
		ctrl_inventory_item_rect.item_slot.clear()


func _refresh() -> void:
	_clear()
	_update_background()
	if !is_instance_valid(item_slot):
		return

	if item_slot.get_item() == null:
		return

	var item := item_slot.get_item()
	if is_instance_valid(_label):
		_label.text = item.get_property(InventoryControl.KEY_NAME, item.prototype_id)
	if is_instance_valid(_ctrl_inventory_item):
		_ctrl_inventory_item.item = item
		if item.get_texture():
			_ctrl_inventory_item.texture = item.get_texture()

		if _ctrl_inventory_item.texture:
			_ctrl_inventory_item.custom_minimum_size = (
				_ctrl_inventory_item.texture.get_size() * icon_scaling
			)


func _clear() -> void:
	if is_instance_valid(_label):
		_label.text = ""
	if is_instance_valid(_ctrl_inventory_item):
		_ctrl_inventory_item.item = null
		_ctrl_inventory_item.texture = default_item_icon
