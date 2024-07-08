extends "inventory_constraint.gd"

## Implements the grid constraint, which limits the inventory to a 2D grid of a given size.

signal size_changed

const Verify := preload("inventory_verify.gd")
const GridConstraint := preload("inventory_grid_constraint.gd")
const StacksConstraint := preload("inventory_stacks_constraint.gd")
const ItemMap := preload("inventory_item_map.gd")

# TODO: Replace KEY_WIDTH and KEY_HEIGHT with KEY_SIZE
const KEY_WIDTH := "width"
const KEY_HEIGHT := "height"
const KEY_SIZE := "size"
const KEY_ROTATED := "rotated"
const KEY_POSITIVE_ROTATION := "positive_rotation"
const DEFAULT_SIZE := Vector2i(10, 10)

@export var size := DEFAULT_SIZE:
	set(new_size):
		assert(inventory, "Inventory not set!")
		assert(new_size.x > 0, "Inventory width must be positive!")
		assert(new_size.y > 0, "Inventory height must be positive!")
		var old_size := size
		size = new_size
		if !Engine.is_editor_hint():
			if _bounds_broken():
				size = old_size
		if size != old_size:
			_refresh_item_map()
			size_changed.emit()

var _item_map := ItemMap.new(Vector2i.ZERO)


func _refresh_item_map() -> void:
	_item_map.resize(size)
	_fill_item_map()


func _fill_item_map() -> void:
	for item in inventory.get_items():
		_item_map.fill_rect(get_item_rect(item), item)


func _on_inventory_set() -> void:
	_refresh_item_map()


func on_item_added(item: InterfaceInventoryItem) -> void:
	if item == null:
		return
	_item_map.fill_rect(get_item_rect(item), item)


func on_item_removed(item: InterfaceInventoryItem) -> void:
	_item_map.clear_rect(get_item_rect(item))


func on_item_modified(_item: InterfaceInventoryItem) -> void:
	_refresh_item_map()


func _bounds_broken() -> bool:
	for item in inventory.get_items():
		if !rect_free(get_item_rect(item), item):
			return true

	return false


func get_item_position(item: InterfaceInventoryItem) -> Vector2i:
	return item.grid_position


# TODO: Consider making a static "unsafe" version of this
func set_item_position(item: InterfaceInventoryItem, new_position: Vector2i) -> bool:
	var new_rect := Rect2i(new_position, get_item_size(item))
	if inventory.has_item(item) and !rect_free(new_rect, item):
		return false

	item.grid_position = new_position
	return true


func get_item_size(item: InterfaceInventoryItem) -> Vector2i:
	var result := Vector2i.ZERO
	var item_data := item.get_metadata()
	if GridConstraint.is_item_rotated(item):
		result.x = item_data.height
		result.y = item_data.width
	else:
		result.x = item_data.width
		result.y = item_data.height
	return result


static func is_item_rotated(_item: InterfaceInventoryItem) -> bool:
	# var item_data := item.get_metadata()
	# return item_data.rotated
	return false


static func is_item_rotation_positive(_item: InterfaceInventoryItem) -> bool:
	# var item_data := item.get_metadata()
	# return item_data.positive_rotation
	return false


func can_rotate_item(item: InterfaceInventoryItem) -> bool:
	var rotated_rect := get_item_rect(item)
	var temp := rotated_rect.size.x
	rotated_rect.size.x = rotated_rect.size.y
	rotated_rect.size.y = temp
	return rect_free(rotated_rect, item)


func get_item_rect(item: InterfaceInventoryItem) -> Rect2i:
	var item_pos := get_item_position(item)
	var item_size := get_item_size(item)
	return Rect2i(item_pos, item_size)


func _get_prototype_size(prototype_id: String) -> Vector2i:
	assert(inventory, "Inventory not set!")
	var item_data := ItemManager.get_item(prototype_id)
	var width := item_data.width
	var height := item_data.height
	return Vector2i(width, height)


func _is_sorted() -> bool:
	assert(inventory, "Inventory not set!")
	for item1 in inventory.get_items():
		for item2 in inventory.get_items():
			if item1 == item2:
				continue

			var rect1: Rect2i = get_item_rect(item1)
			var rect2: Rect2i = get_item_rect(item2)
			if rect1.intersects(rect2):
				return false

	return true


func add_item_at(item: InterfaceInventoryItem, position: Vector2i) -> bool:
	assert(inventory, "Inventory not set!")

	var item_size := get_item_size(item)
	var rect := Rect2i(position, item_size)
	if rect_free(rect):
		if not inventory.add_item(item):
			return false
		assert(move_item_to(item, position), "Can't move the item to the given place!")
		return true

	return false


func create_and_add_item_at(item: InventoryItemModel) -> InterfaceInventoryItem:
	assert(inventory, "Inventory not set!")
	var item_rect := Rect2i(item.grid_position, _get_prototype_size(item.id))
	if !rect_free(item_rect):
		return null

	var inventory_item := inventory.create_and_add_item(item)
	if inventory_item == null:
		return null

	if not move_item_to(inventory_item, item.grid_position):
		inventory.remove_item(inventory_item)
		return null

	return inventory_item


func get_item_at(position: Vector2i) -> InterfaceInventoryItem:
	assert(inventory, "Inventory not set!")

	if !_item_map.contains(position):
		return null
	return _item_map.get_field(position)


func get_items_under(rect: Rect2i) -> Array[InterfaceInventoryItem]:
	assert(inventory, "Inventory not set!")
	var result: Array[InterfaceInventoryItem] = []
	for item in inventory.get_items():
		var item_rect := get_item_rect(item)
		if item_rect.intersects(rect):
			result.append(item)
	return result


func move_item_to(item: InterfaceInventoryItem, position: Vector2i) -> bool:
	assert(inventory, "Inventory not set!")
	var item_size := get_item_size(item)
	var rect := Rect2i(position, item_size)
	if rect_free(rect, item):
		_move_item_to_unsafe(item, position)
		inventory.contents_changed.emit()
		return true

	return false


func move_item_to_free_spot(item: InterfaceInventoryItem) -> bool:
	if rect_free(get_item_rect(item), item):
		return true

	var free_place := find_free_place(item, item)
	if not free_place.success:
		return false

	return move_item_to(item, free_place.position)


func _move_item_to_unsafe(item: InterfaceInventoryItem, position: Vector2i) -> void:
	item.grid_position = position


func transfer_to(
	item: InterfaceInventoryItem, destination: GridConstraint, position: Vector2i
) -> bool:
	assert(inventory, "Inventory not set!")
	assert(destination.inventory, "Destination inventory not set!")
	var item_size := get_item_size(item)
	var rect := Rect2i(position, item_size)
	if destination.rect_free(rect):
		if inventory.transfer(item, destination.inventory):
			destination.move_item_to(item, position)
			return true

	return _merge_to(item, destination, position)


func _merge_to(
	item: InterfaceInventoryItem, destination: GridConstraint, position: Vector2i
) -> bool:
	var item_dst: Variant = destination.get_mergeable_item_at(item, position)
	if item_dst == null:
		return false

	return inventory._constraint_manager.get_stacks_constraint().join_stacks(item_dst, item)


func get_mergeable_item_at(
	item: InterfaceInventoryItem, position: Vector2i
) -> InterfaceInventoryItem:
	if inventory._constraint_manager.get_stacks_constraint() == null:
		return null

	var rect := Rect2i(position, get_item_size(item))
	var mergeable_items := _get_mergeable_items_under(item, rect)
	for mergeable_item in mergeable_items:
		if inventory._constraint_manager.get_stacks_constraint().stacks_joinable(
			item, mergeable_item
		):
			return mergeable_item
	return null


func _get_mergeable_items_under(
	item: InterfaceInventoryItem, rect: Rect2i
) -> Array[InterfaceInventoryItem]:
	var result: Array[InterfaceInventoryItem] = []

	for item_dst in get_items_under(rect):
		if item_dst == item:
			continue
		if StacksConstraint.items_mergeable(item_dst, item):
			result.append(item_dst)

	return result


func rect_free(rect: Rect2i, exception: InterfaceInventoryItem = null) -> bool:
	assert(inventory, "Inventory not set!")

	if rect.position.x < 0 || rect.position.y < 0 || rect.size.x < 1 || rect.size.y < 1:
		return false
	if rect.position.x + rect.size.x > size.x:
		return false
	if rect.position.y + rect.size.y > size.y:
		return false

	for i in range(rect.position.x, rect.position.x + rect.size.x):
		for j in range(rect.position.y, rect.position.y + rect.size.y):
			var field := _item_map.get_field(Vector2i(i, j))
			if field && field != exception:
				return false
	return true


# TODO: Check if this is needed after adding find_free_space
func find_free_place(
	item: InterfaceInventoryItem, exception: InterfaceInventoryItem = null
) -> Dictionary:
	var result := {success = false, position = Vector2i(-1, -1)}
	var item_size := get_item_size(item)
	for x in range(size.x - (item_size.x - 1)):
		for y in range(size.y - (item_size.y - 1)):
			var rect := Rect2i(Vector2i(x, y), item_size)
			if rect_free(rect, exception):
				result.success = true
				result.position = Vector2i(x, y)
				return result

	return result


func _compare_items(item1: InterfaceInventoryItem, item2: InterfaceInventoryItem) -> bool:
	var rect1 := Rect2i(get_item_position(item1), get_item_size(item1))
	var rect2 := Rect2i(get_item_position(item2), get_item_size(item2))
	return rect1.get_area() > rect2.get_area()


func sort() -> bool:
	assert(inventory, "Inventory not set!")

	var item_array: Array[InterfaceInventoryItem] = []
	for item in inventory.get_items():
		item_array.append(item)
	item_array.sort_custom(_compare_items)

	for item in item_array:
		_move_item_to_unsafe(item, -get_item_size(item))

	for item in item_array:
		var free_place := find_free_place(item)
		if !free_place.success:
			return false
		move_item_to(item, free_place.position)

	return true


func _sort_if_needed() -> void:
	if !_is_sorted() || _bounds_broken():
		sort()


func get_space_for(item: InterfaceInventoryItem) -> InventoryItemCount:
	var occupied_rects: Array[Rect2i] = []
	var item_size := get_item_size(item)
	if item_size == Vector2i.ONE:
		return InventoryItemCount.new(_item_map.free_fields)

	var free_space := find_free_space(item_size, occupied_rects)
	while free_space.success:
		occupied_rects.append(Rect2i(free_space.position, item_size))
		free_space = find_free_space(item_size, occupied_rects)
	return InventoryItemCount.new(occupied_rects.size())


func has_space_for(item: InterfaceInventoryItem) -> bool:
	var item_size := get_item_size(item)
	if item_size == Vector2i.ONE:
		return _item_map.free_fields > 0

	return find_free_space(item_size).success


# TODO: Check if find_free_place is needed
func find_free_space(item_size: Vector2i, occupied_rects: Array[Rect2i] = []) -> Dictionary:
	var result := {success = false, position = Vector2i(-1, -1)}
	for x in range(size.x - (item_size.x - 1)):
		for y in range(size.y - (item_size.y - 1)):
			var rect := Rect2i(Vector2i(x, y), item_size)
			if (
				rect_free(rect)
				and not GridConstraint.rect_intersects_rect_array(rect, occupied_rects)
			):
				result.success = true
				result.position = Vector2i(x, y)
				return result

	return result


static func rect_intersects_rect_array(rect: Rect2i, occupied_rects: Array[Rect2i] = []) -> bool:
	for occupied_rect in occupied_rects:
		if rect.intersects(occupied_rect):
			return true
	return false


func reset() -> void:
	size = DEFAULT_SIZE


func serialize() -> Dictionary:
	var result := {}

	# Store Vector2i as string to make JSON conversion easier later
	result[KEY_SIZE] = var_to_str(size)

	return result


func deserialize(source: Dictionary) -> bool:
	if !Verify.dict(source, true, KEY_SIZE, TYPE_STRING):
		return false

	reset()

	var s: Vector2i = str_to_var(source[KEY_SIZE])
	self.size = s

	return true
