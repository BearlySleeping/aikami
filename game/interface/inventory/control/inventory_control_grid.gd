@tool
class_name InventoryControlGrid
extends Control
## A UI control representing a grid based inventory (InventoryGrid).
## Displays a grid based on the inventory capacity (width and height)
## and the contained items on the grid. The items can be moved around
## in the inventory by dragging.

## Emitted when a grabbed InventoryItem is dropped.
signal item_dropped(item: InventoryItem, offset: Vector2)
## Emitted when the selection has changed. Use get_selected_inventory_item() to obtain the currently selected item.
signal selection_changed
## Emitted when an InventoryItem is activated (i.e. double clicked).
signal inventory_item_activated(item: InventoryItem)
## Emitted when the context menu of an InventoryItem is activated (i.e. right clicked).
signal inventory_item_context_activated(item: InventoryItem)
## Emitted when the mouse enters the Rect area of the control representing the given InventoryItem.
signal item_mouse_entered(item: InventoryItem)
## Emitted when the mouse leaves the Rect area of the control representing the given InventoryItem.
signal item_mouse_exited(item: InventoryItem)

const DropZone := preload("inventory_control_drop_zone.gd")
const Draggable := preload("inventory_control_draggable.gd")
const Verify := preload("../constraints/inventory_verify.gd")

## The size of each inventory field in pixels.
## @default Vector2(32, 32)
@export var field_dimensions := Vector2(32, 32):
	set(new_field_dimensions):
		field_dimensions = new_field_dimensions
		_refresh()

## The spacing between items in pixels.
## @default 0
@export var item_spacing := 0:
	set(new_item_spacing):
		item_spacing = new_item_spacing
		_refresh()

## Displays a grid if true.
## @default true
@export var draw_grid := true:
	set(new_draw_grid):
		draw_grid = new_draw_grid
		_refresh()

## The color of the grid.
## @default Color.BLACK
@export var grid_color := Color.BLACK:
	set(new_grid_color):
		grid_color = new_grid_color
		_refresh()

## Draws a rectangle behind the selected item if true.
@export var draw_selections := false:
	set(new_draw_selections):
		draw_selections = new_draw_selections

## The color of the selection.
## @default Color.GRAY
@export var selection_color := Color.GRAY

## Path to an Inventory node.
## @required
@export var inventory_path: NodePath:
	set(new_inv_path):
		inventory_path = new_inv_path
		var node: Node = get_node_or_null(inventory_path)

		if node == null:
			return

		if is_inside_tree():
			assert(node is InventoryGrid)

		inventory = node
		update_configuration_warnings()

## The default texture that will be used for items with no image property.
## @required
@export var default_item_texture: Texture2D:
	set(new_default_item_texture):
		default_item_texture = new_default_item_texture
		_refresh()

##  If true, the inventory item sprites will be stretched to fit the inventory fields they are positioned on.
## @default true
@export var stretch_item_sprites := true:
	set(new_stretch_item_sprites):
		stretch_item_sprites = new_stretch_item_sprites
		_refresh()
## The z-index used for the dragged InventoryItem in order to appear above other UI elements.
## @default 1
@export var drag_sprite_z_index := 1

## Style of a single inventory field.
@export var field_style: StyleBox:
	set(new_field_style):
		field_style = new_field_style
		_refresh()
## Style of a single inventory field when the mouse hovers over it.
@export var field_highlighted_style: StyleBox:
	set(new_field_highlighted_style):
		field_highlighted_style = new_field_highlighted_style
		_refresh()
## Style of a single inventory field when the item on top of it is selected.
@export var field_selected_style: StyleBox:
	set(new_field_selected_style):
		field_selected_style = new_field_selected_style
		_refresh()
## Style of a rectangle that will be drawn on top of the selected item.
@export var selection_style: StyleBox:
	set(new_selection_style):
		selection_style = new_selection_style
		_refresh()

var inventory: InventoryGrid:
	set(new_inventory):
		if inventory == new_inventory:
			return

		_select(null)

		_disconnect_inventory_signals()
		inventory = new_inventory
		_connect_inventory_signals()

		_refresh()

var _inventory_control_item_container: Control
var _inventory_control_drop_zone: DropZone
var _selected_item: InventoryItem

var _field_background_grid: Control
var _field_backgrounds: Array
var _selection_panel: Panel
var _pending_highlights: Array[Dictionary] = []


func _get_configuration_warnings() -> PackedStringArray:
	if inventory_path.is_empty():
		return PackedStringArray(
			[
				(
					"This node is not linked to an inventory, so it can't display any content.\n"
					+ "Set the inventory_path property to point to an InventoryGrid node."
				)
			]
		)
	return PackedStringArray()


func _ready() -> void:
	if Engine.is_editor_hint():
		# Clean up, in case it is duplicated in the editor
		if is_instance_valid(_inventory_control_item_container):
			_inventory_control_item_container.queue_free()

	_inventory_control_item_container = Control.new()
	_inventory_control_item_container.size_flags_horizontal = SIZE_EXPAND_FILL
	_inventory_control_item_container.size_flags_vertical = SIZE_EXPAND_FILL
	_inventory_control_item_container.anchor_right = 1.0
	_inventory_control_item_container.anchor_bottom = 1.0
	add_child(_inventory_control_item_container)

	_inventory_control_drop_zone = DropZone.new()
	_inventory_control_drop_zone.draggable_dropped.connect(_on_draggable_dropped)
	_inventory_control_drop_zone.size = size
	resized.connect(func() -> void: _inventory_control_drop_zone.size = size)
	Draggable.draggable_grabbed.connect(
		func(_draggable: Draggable, _grab_position: Vector2) -> void: (
			_inventory_control_drop_zone.activate()
		)
	)
	Draggable.draggable_dropped.connect(
		func(_draggable: Draggable, _zone: DropZone, _drop_position: Vector2) -> void: (
			_inventory_control_drop_zone.deactivate()
		)
	)
	_inventory_control_drop_zone.mouse_entered.connect(_on_drop_zone_mouse_entered)
	_inventory_control_drop_zone.mouse_exited.connect(_on_drop_zone_mouse_exited)
	add_child(_inventory_control_drop_zone)
	_inventory_control_drop_zone.deactivate()

	_inventory_control_item_container.resized.connect(
		func() -> void: _inventory_control_drop_zone.size = _inventory_control_item_container.size
	)

	if has_node(inventory_path):
		inventory = get_node_or_null(inventory_path)

	_refresh()
	_create_selection_panel()
	_create_field_background_grid()
	selection_changed.connect(_on_selection_changed)


func _draw() -> void:
	if !is_instance_valid(inventory):
		return
	if draw_grid:
		_draw_grid(Vector2.ZERO, inventory.size.x, inventory.size.y, field_dimensions, item_spacing)


func populate_inventory(items: Array[InventoryItemModel]) -> void:
	for item in items:
		inventory.create_and_add_item_at(item)


func get_inventory_items() -> Array[InventoryItemModel]:
	var current_items: Array[InventoryItemModel] = []
	for item in inventory.get_items():
		var item_properties := item.properties
		current_items.append(
			InventoryItemModel.new(
				{
					"id": item.prototype_id,
					"amount": item_properties.get("stack_size", 1),
					"position": item_properties.get("grid_position", Vector2i(0, 0))
				}
			)
		)
	return current_items


## Deselects the selected item.
func deselect_inventory_item() -> void:
	_select(null)


## Selects the given item.
func select_inventory_item(item: InventoryItem) -> void:
	_select(item)


## Converts the given global coordinates to local inventory field coordinates.
func get_field_coords(local_position: Vector2) -> Vector2i:
	# We have to consider the item spacing when calculating field coordinates, thus we expand the
	# size of each field by Vector2(item_spacing, item_spacing).
	var field_dimensions_ex := field_dimensions + Vector2(item_spacing, item_spacing)

	# We also don't want the item spacing to disturb snapping to the closest field, so we add half
	# the spacing to the local coordinates.
	var local_position_ex := local_position + (Vector2(item_spacing, item_spacing) / 2)

	var x := int(local_position_ex.x / (field_dimensions_ex.x))
	var y := int(local_position_ex.y / (field_dimensions_ex.y))
	return Vector2i(x, y)


## Returns the currently selected item.
func get_selected_inventory_item() -> InventoryItem:
	return _selected_item


func _connect_inventory_signals() -> void:
	if !is_instance_valid(inventory):
		return

	if !inventory.contents_changed.is_connected(_refresh):
		inventory.contents_changed.connect(_refresh)
	if !inventory.item_modified.is_connected(_on_item_modified):
		inventory.item_modified.connect(_on_item_modified)
	if !inventory.size_changed.is_connected(_on_inventory_resized):
		inventory.size_changed.connect(_on_inventory_resized)
	if !inventory.item_removed.is_connected(_on_item_removed):
		inventory.item_removed.connect(_on_item_removed)


func _disconnect_inventory_signals() -> void:
	if !is_instance_valid(inventory):
		return

	if inventory.contents_changed.is_connected(_refresh):
		inventory.contents_changed.disconnect(_refresh)
	if inventory.item_modified.is_connected(_on_item_modified):
		inventory.item_modified.disconnect(_on_item_modified)
	if inventory.size_changed.is_connected(_on_inventory_resized):
		inventory.size_changed.disconnect(_on_inventory_resized)
	if inventory.item_removed.is_connected(_on_item_removed):
		inventory.item_removed.disconnect(_on_item_removed)


func _on_item_modified(_item: InventoryItem) -> void:
	_refresh()


func _on_inventory_resized() -> void:
	_refresh()
	_refresh_field_background_grid()


func _on_item_removed(_item: InventoryItem) -> void:
	if _item == _selected_item:
		_select(null)


func _refresh() -> void:
	_refresh_grid_container()
	_clear_list()
	_populate_list()
	queue_redraw()
	_refresh_field_background_grid()


func _move_item(item: InventoryItem, move_position: Vector2i) -> void:
	inventory.move_item_to(item, move_position)


func _merge_item(item_src: InventoryItem, item_position: Vector2i) -> void:
	var item_dst := (inventory as InventoryGridStacked).get_mergeable_item_at(
		item_src, item_position
	)
	if item_dst == null:
		return
	(inventory as InventoryGridStacked).join(item_dst, item_src)


func _get_field_position(field_coords: Vector2i) -> Vector2:
	var field_position := Vector2(
		field_coords.x * field_dimensions.x, field_coords.y * field_dimensions.y
	)
	field_position += Vector2(item_spacing * field_coords)
	return field_position


func _get_global_field_position(field_coords: Vector2i) -> Vector2:
	return _get_field_position(field_coords) + global_position


func _draw_grid(pos: Vector2, w: int, h: int, fsize: Vector2, spacing: int) -> void:
	if w <= 0 || h <= 0 || spacing < 0:
		return

	if spacing <= 1:
		var rect := Rect2(pos, _get_inventory_size_px())
		draw_rect(rect, grid_color, false)
		for i in range(w):
			var from: Vector2 = Vector2(i * fsize.x, 0) + pos
			var to: Vector2 = Vector2(i * fsize.x, rect.size.y) + pos
			from += Vector2(spacing, 0)
			to += Vector2(spacing, 0)
			draw_line(from, to, grid_color)
		for j in range(h):
			var from: Vector2 = Vector2(0, j * fsize.y) + pos
			var to: Vector2 = Vector2(rect.size.x, j * fsize.y) + pos
			from += Vector2(0, spacing)
			to += Vector2(0, spacing)
			draw_line(from, to, grid_color)
	else:
		for i in range(w):
			for j in range(h):
				var field_pos := pos + Vector2(i * fsize.x, j * fsize.y) + Vector2(i, j) * spacing
				var field_rect := Rect2(field_pos, fsize)
				draw_rect(field_rect, grid_color, false)


func _get_inventory_size_px() -> Vector2:
	var result := Vector2(
		inventory.size.x * field_dimensions.x, inventory.size.y * field_dimensions.y
	)

	# Also take item spacing into consideration
	result += Vector2(inventory.size - Vector2i.ONE) * item_spacing

	return result


func _refresh_grid_container() -> void:
	if !is_instance_valid(inventory):
		return

	custom_minimum_size = _get_inventory_size_px()
	size = custom_minimum_size


func _clear_list() -> void:
	if !is_instance_valid(_inventory_control_item_container):
		return

	for ctrl_inventory_item in _inventory_control_item_container.get_children():
		_inventory_control_item_container.remove_child(ctrl_inventory_item)
		ctrl_inventory_item.queue_free()


func _populate_list() -> void:
	if !is_instance_valid(inventory) || !is_instance_valid(_inventory_control_item_container):
		return

	for item in inventory.get_items():
		var ctrl_inventory_item := InventoryControlItem.new()
		ctrl_inventory_item.texture = default_item_texture
		ctrl_inventory_item.item = item
		ctrl_inventory_item.drag_z_index = drag_sprite_z_index
		ctrl_inventory_item.grabbed.connect(_on_item_grab.bind(ctrl_inventory_item))
		ctrl_inventory_item.dropped.connect(_on_item_drop.bind(ctrl_inventory_item))
		ctrl_inventory_item.activated.connect(_on_item_activated.bind(ctrl_inventory_item))
		ctrl_inventory_item.context_activated.connect(
			_on_item_context_activated.bind(ctrl_inventory_item)
		)
		ctrl_inventory_item.mouse_entered.connect(_on_item_mouse_entered.bind(ctrl_inventory_item))
		ctrl_inventory_item.mouse_exited.connect(_on_item_mouse_exited.bind(ctrl_inventory_item))
		ctrl_inventory_item.size = _get_item_sprite_size(item)

		ctrl_inventory_item.position = _get_field_position(inventory.get_item_position(item))
		if !stretch_item_sprites:
			# Position the item centered when it's not stretched
			ctrl_inventory_item.position += _get_unstreched_sprite_offset(item)

		_inventory_control_item_container.add_child(ctrl_inventory_item)

	_refresh_selection()


func _refresh_selection() -> void:
	if !draw_selections:
		return

	if !is_instance_valid(_inventory_control_item_container):
		return

	for ctrl_item in _inventory_control_item_container.get_children():
		ctrl_item.selected = ctrl_item.item && (ctrl_item.item == _selected_item)
		ctrl_item.selection_bg_color = selection_color

	if !is_instance_valid(_selection_panel):
		return
	_selection_panel.visible = (_selected_item) && (selection_style)
	if _selected_item:
		move_child(_selection_panel, get_child_count() - 1)

		var selection_pos := _get_field_position(inventory.get_item_position(_selected_item))
		var selection_size := _get_stretched_item_sprite_size(_selected_item)
		_selection_panel.position = selection_pos
		_selection_panel.size = selection_size


func _on_item_grab(_offset: Vector2, _ctrl_inventory_item: InventoryControlItem) -> void:
	_select(null)


func _on_item_drop(
	_zone: DropZone, _drop_position: Vector2, ctrl_inventory_item: InventoryControlItem
) -> void:
	var item := ctrl_inventory_item.item
	# The item might have been freed in case the item stack has been moved and merged with another
	# stack.
	if is_instance_valid(item) and inventory.has_item(item):
		_select(item)


func _get_item_sprite_size(item: InventoryItem) -> Vector2:
	if stretch_item_sprites:
		return _get_stretched_item_sprite_size(item)

	return item.get_texture().get_size()


func _get_stretched_item_sprite_size(item: InventoryItem) -> Vector2:
	var item_size := inventory.get_item_size(item)
	var sprite_size := Vector2(item_size) * field_dimensions

	# Also take item spacing into consideration
	sprite_size += (Vector2(item_size) - Vector2.ONE) * item_spacing

	return sprite_size


func _get_unstreched_sprite_offset(item: InventoryItem) -> Vector2:
	var texture := item.get_texture()
	if texture == null:
		texture = default_item_texture
	if texture == null:
		return Vector2.ZERO
	return (_get_stretched_item_sprite_size(item) - texture.get_size()) / 2


func _on_item_activated(ctrl_inventory_item: InventoryControlItem) -> void:
	var item := ctrl_inventory_item.item
	if !item:
		return

	inventory_item_activated.emit(item)


func _on_item_context_activated(ctrl_inventory_item: InventoryControlItem) -> void:
	var item := ctrl_inventory_item.item
	if !item:
		return

	inventory_item_context_activated.emit(item)


func _on_item_mouse_entered(ctrl_inventory_item: InventoryControlItem) -> void:
	item_mouse_entered.emit(ctrl_inventory_item.item)


func _on_item_mouse_exited(ctrl_inventory_item: InventoryControlItem) -> void:
	item_mouse_exited.emit(ctrl_inventory_item.item)


func _select(item: InventoryItem) -> void:
	if item == _selected_item:
		return

	_selected_item = item
	_refresh_selection()
	selection_changed.emit()


func _on_drop_zone_mouse_entered() -> void:
	if Draggable.grabbed_draggable == null:
		return
	var grabbed_inventory_control_item := Draggable.grabbed_draggable as InventoryControlItem
	if grabbed_inventory_control_item == null || grabbed_inventory_control_item.item == null:
		return
	InventoryControlItem.override_preview_size(
		_get_item_sprite_size(grabbed_inventory_control_item.item)
	)


func _on_drop_zone_mouse_exited() -> void:
	InventoryControlItem.restore_preview_size()


func _on_draggable_dropped(draggable: Draggable, drop_position: Vector2) -> void:
	var item: InventoryItem = draggable.item
	if item == null:
		return

	if !is_instance_valid(inventory):
		return

	if inventory.has_item(item):
		_handle_item_move(item, drop_position)
	else:
		_handle_item_transfer(item, drop_position)


func _handle_item_move(item: InventoryItem, drop_position: Vector2) -> void:
	var field_coords := get_field_coords(drop_position + (field_dimensions / 2))
	if inventory.rect_free(Rect2i(field_coords, inventory.get_item_size(item)), item):
		_move_item(item, field_coords)
	elif inventory is InventoryGridStacked:
		_merge_item(item, field_coords)


func _handle_item_transfer(item: InventoryItem, drop_position: Vector2) -> void:
	var source_inventory: InventoryGrid = item.get_inventory()

	var field_coords := get_field_coords(drop_position + (field_dimensions / 2))
	if source_inventory:
		if source_inventory.item_protoset != inventory.item_protoset:
			return
		source_inventory.transfer_to(item, inventory, field_coords)
	else:
		inventory.add_item_at(item, field_coords)


func _queue_highlight(p_rect: Rect2, p_style: StyleBox) -> void:
	_pending_highlights.push_back({rect = p_rect, style = p_style})


func _dequeue_highlight() -> Dictionary:
	var dict: Variant = _pending_highlights.pop_front()
	return dict if dict else {}


func _refresh_field_background_grid() -> void:
	if is_instance_valid(_field_background_grid):
		remove_child(_field_background_grid)
		_field_background_grid.queue_free()
		_field_background_grid = null
		_field_backgrounds = []
	_create_field_background_grid()


func _create_field_background_grid() -> void:
	if !is_instance_valid(inventory) || is_instance_valid(_field_background_grid):
		return
	_field_background_grid = Control.new()
	add_child(_field_background_grid)
	move_child(_field_background_grid, 0)

	for i in range(inventory.size.x):
		_field_backgrounds.append([])
		for j in range(inventory.size.y):
			var field_panel: Panel = Panel.new()
			_set_panel_style(field_panel, field_style)
			field_panel.visible = !!field_style
			field_panel.size = field_dimensions
			field_panel.position = _get_field_position(Vector2i(i, j))
			_field_background_grid.add_child(field_panel)
			_field_backgrounds[i].append(field_panel)


func _create_selection_panel() -> void:
	if !is_instance_valid(_selection_panel):
		return
	_selection_panel = Panel.new()
	add_child(_selection_panel)
	move_child(_selection_panel, get_child_count() - 1)
	_set_panel_style(_selection_panel, selection_style)
	_selection_panel.visible = (_selected_item) && (selection_style)
	_selection_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_selection_panel.mouse_entered.connect(func() -> void: item_mouse_entered.emit(_selected_item))
	_selection_panel.mouse_exited.connect(func() -> void: item_mouse_exited.emit(_selected_item))


func _set_panel_style(panel: Panel, style: StyleBox) -> void:
	panel.remove_theme_stylebox_override("panel")
	if style:
		panel.add_theme_stylebox_override("panel", style)


func _on_selection_changed() -> void:
	if !is_instance_valid(inventory):
		return
	if !field_selected_style:
		return
	for item in inventory.get_items():
		if item == get_selected_inventory_item():
			_queue_highlight(inventory.get_item_rect(item), field_selected_style)
		else:
			_queue_highlight(inventory.get_item_rect(item), field_style)


func _input(event: InputEvent) -> void:
	if !(event is InputEventMouseMotion):
		return
	if !is_instance_valid(inventory):
		return
	var hovered_field_coords := Vector2i(-1, -1)
	if _is_hovering(get_local_mouse_position()):
		hovered_field_coords = get_field_coords(get_local_mouse_position())
	_reset_highlights()
	if !field_highlighted_style:
		return
	if _highlight_grabbed_item(field_highlighted_style):
		return
	_highlight_hovered_fields(hovered_field_coords, field_highlighted_style)


func _reset_highlights() -> void:
	while true:
		var highlight := _dequeue_highlight()
		if highlight.is_empty():
			break
		_highlight_rect(highlight.rect, highlight.style, false)


func _highlight_hovered_fields(field_coords: Vector2i, style: StyleBox) -> void:
	if !style || !Verify.vector_positive(field_coords):
		return
	if _highlight_item(inventory.get_item_at(field_coords), style):
		return
	_highlight_field(field_coords, style)


func _highlight_grabbed_item(style: StyleBox) -> bool:
	var grabbed_item: InventoryItem = _get_global_grabbed_item()
	if !grabbed_item:
		return false
	var global_grabbed_item_pos: Vector2 = _get_global_grabbed_item_local_pos()
	if !_is_hovering(global_grabbed_item_pos):
		return false
	var grabbed_item_coords := get_field_coords(global_grabbed_item_pos + (field_dimensions / 2))
	var item_size := inventory.get_item_size(grabbed_item)
	var rect := Rect2i(grabbed_item_coords, item_size)
	_highlight_rect(rect, style, true)
	return true


func _is_hovering(local_pos: Vector2) -> bool:
	return get_rect().has_point(local_pos)


func _highlight_item(item: InventoryItem, style: StyleBox) -> bool:
	if !item || !style:
		return false

		# Don't highlight the selected item (done in _on_selection_changed())
	if item == _selected_item:
		# Don't highlight the selected item (done in _on_selection_changed())
		return false
	_highlight_rect(inventory.get_item_rect(item), style, true)
	return true


func _highlight_field(field_coords: Vector2i, style: StyleBox) -> void:
	if _selected_item && inventory.get_item_rect(_selected_item).has_point(field_coords):
		# Don't highlight selected fields (done in _on_selection_changed())
		return
	_highlight_rect(Rect2i(field_coords, Vector2i.ONE), style, true)


func _highlight_rect(rect: Rect2i, style: StyleBox, queue_for_reset: bool) -> void:
	var h_range: int = min(rect.size.x + rect.position.x, inventory.size.x)
	for i in range(rect.position.x, h_range):
		var v_range: int = min(rect.size.y + rect.position.y, inventory.size.y)
		for j in range(rect.position.y, v_range):
			_set_panel_style(_field_backgrounds[i][j], style)
	if queue_for_reset:
		_queue_highlight(rect, field_style)


func _get_global_grabbed_item() -> InventoryItem:
	if Draggable.grabbed_draggable == null:
		return null
	return (Draggable.grabbed_draggable as InventoryControlItem).item


func _get_global_grabbed_item_local_pos() -> Vector2:
	if Draggable.grabbed_draggable:
		return get_local_mouse_position() - Draggable.get_grab_offset()
	return Vector2(-1, -1)
