class_name InventoryControlItem
extends "inventory_control_draggable.gd"

signal activated
signal context_activated

const StacksConstraint := preload("../constraints/inventory_stacks_constraint.gd")
const GridConstraint := preload("../constraints/inventory_grid_constraint.gd")

var item: InventoryItem:
	set(new_item):
		if item == new_item:
			return

		_disconnect_item_signals()
		_connect_item_signals(new_item)

		item = new_item
		if item:
			texture = item.get_texture()
		else:
			texture = null

var texture: Texture2D:
	set(new_texture):
		if new_texture == texture:
			return
		texture = new_texture
		_update_texture()

var selected := false:
	set(new_selected):
		if new_selected == selected:
			return
		selected = new_selected
		_update_selection()

var selection_bg_color := Color.GRAY:
	set(new_selection_bg_color):
		if new_selection_bg_color == selection_bg_color:
			return
		selection_bg_color = new_selection_bg_color
		_update_selection()

var item_slot: InventoryItemSlot
var _selection_rect: ColorRect
var _texture_rect: TextureRect
var _stack_size_label: Label

static var _stored_preview_size: Vector2
static var _stored_preview_offset: Vector2


func _connect_item_signals(new_item: InventoryItem) -> void:
	if new_item == null:
		return

	if !new_item.protoset_changed.is_connected(_refresh):
		new_item.protoset_changed.connect(_refresh)
	if !new_item.prototype_id_changed.is_connected(_refresh):
		new_item.prototype_id_changed.connect(_refresh)
	if !new_item.properties_changed.is_connected(_refresh):
		new_item.properties_changed.connect(_refresh)


func _disconnect_item_signals() -> void:
	if !is_instance_valid(item):
		return

	if item.protoset_changed.is_connected(_refresh):
		item.protoset_changed.disconnect(_refresh)
	if item.prototype_id_changed.is_connected(_refresh):
		item.prototype_id_changed.disconnect(_refresh)
	if item.properties_changed.is_connected(_refresh):
		item.properties_changed.disconnect(_refresh)


func _get_item_position() -> Vector2:
	if is_instance_valid(item) && item.get_inventory():
		return item.get_inventory().get_item_position(item)
	return Vector2(0, 0)


func _ready() -> void:
	drag_preview = InventoryControlItem.new()

	_selection_rect = ColorRect.new()
	_selection_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_texture_rect = TextureRect.new()
	_texture_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_texture_rect.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_stack_size_label = Label.new()
	_stack_size_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_stack_size_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_stack_size_label.vertical_alignment = VERTICAL_ALIGNMENT_BOTTOM
	add_child(_selection_rect)
	add_child(_texture_rect)
	add_child(_stack_size_label)

	resized.connect(_on_resized)

	_refresh()


func _on_resized() -> void:
	_selection_rect.size = size
	_texture_rect.size = size
	_stack_size_label.size = size


func _update_selection() -> void:
	if !is_instance_valid(_selection_rect):
		return
	_selection_rect.visible = selected
	_selection_rect.color = selection_bg_color
	_selection_rect.size = size


func _update_texture() -> void:
	if !is_instance_valid(_texture_rect):
		return
	_texture_rect.texture = texture
	if is_instance_valid(item) && GridConstraint.is_item_rotated(item):
		_texture_rect.size = Vector2(size.y, size.x)
		if GridConstraint.is_item_rotation_positive(item):
			_texture_rect.position = Vector2(_texture_rect.size.y, 0)
			_texture_rect.rotation = PI / 2
		else:
			_texture_rect.position = Vector2(0, _texture_rect.size.x)
			_texture_rect.rotation = -PI / 2

	else:
		_texture_rect.size = size
		_texture_rect.position = Vector2.ZERO
		_texture_rect.rotation = 0


func _update_stack_size() -> void:
	if !is_instance_valid(_stack_size_label):
		return
	if !is_instance_valid(item):
		_stack_size_label.text = ""
		return
	var stack_size: int = StacksConstraint.get_item_stack_size(item)
	if stack_size <= 1:
		_stack_size_label.text = ""
	else:
		_stack_size_label.text = "%d" % stack_size
	_stack_size_label.size = size


func _refresh() -> void:
	_update_selection()
	_update_texture()
	_update_stack_size()


func drag_start() -> void:
	if drag_preview:
		drag_preview.item = item
		drag_preview.texture = texture
		drag_preview.size = size
	super()


static func override_preview_size(s: Vector2) -> void:
	if Draggable.grabbed_draggable == null:
		return
	var grabbed_ctrl := Draggable.grabbed_draggable as InventoryControlItem
	if grabbed_ctrl.item == null || grabbed_ctrl.drag_preview == null:
		return
	_stored_preview_size = grabbed_ctrl.drag_preview.size
	_stored_preview_offset = Draggable._grab_offset
	Draggable._grab_offset *= s / grabbed_ctrl.drag_preview.size
	grabbed_ctrl.drag_preview.size = s


static func restore_preview_size() -> void:
	if Draggable.grabbed_draggable == null:
		return
	var grabbed_ctrl := Draggable.grabbed_draggable as InventoryControlItem
	if grabbed_ctrl.item == null || grabbed_ctrl.drag_preview == null:
		return
	grabbed_ctrl.drag_preview.size = _stored_preview_size
	Draggable._grab_offset = _stored_preview_offset


func _gui_input(event: InputEvent) -> void:
	super(event)
	if !(event is InputEventMouseButton):
		return

	var mb_event: InputEventMouseButton = event
	if mb_event.button_index == MOUSE_BUTTON_LEFT && mb_event.double_click:
		activated.emit()
	elif mb_event.button_index == MOUSE_BUTTON_MASK_RIGHT:
		context_activated.emit()
