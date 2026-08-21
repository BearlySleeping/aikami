class_name InventoryItemCount

const INF := -1

@export var count := 0:
	set(new_count):
		if new_count < 0:
			new_count = -1
		count = new_count


func _init(p_count: int = 0) -> void:
	if p_count < 0:
		p_count = -1
	count = p_count


func is_inf() -> bool:
	return count < 0


func add(p_item_count: InventoryItemCount) -> InventoryItemCount:
	if p_item_count.is_inf():
		count = INF
	elif !self.is_inf():
		count += p_item_count.count

	return self


func mul(p_item_count: InventoryItemCount) -> InventoryItemCount:
	if count == 0:
		return self
	if p_item_count.is_inf():
		count = INF
		return self
	if p_item_count.count == 0:
		count = 0
		return self
	if self.is_inf():
		return self

	count *= p_item_count.count
	return self


func div(p_item_count: InventoryItemCount) -> InventoryItemCount:
	assert(p_item_count.count > 0 || p_item_count.is_inf(), "Can't divide by zero!")
	if count == 0:
		return self
	if p_item_count.is_inf() && self.is_inf():
		count = 1
		return self
	if self.is_inf():
		return self
	if p_item_count.is_inf():
		count = 0
		return self

	count /= p_item_count.count
	return self


func eq(p_item_count: InventoryItemCount) -> bool:
	return p_item_count.count == count


func less(p_item_count: InventoryItemCount) -> bool:
	if p_item_count.is_inf():
		if self.is_inf():
			return false
		return true

	if self.is_inf():
		return false

	return count < p_item_count.count


func le(p_item_count: InventoryItemCount) -> bool:
	return self.less(p_item_count) || self.eq(p_item_count)


func gt(p_item_count: InventoryItemCount) -> bool:
	if p_item_count.is_inf():
		if self.is_inf():
			return false
		return false

	if self.is_inf():
		return true

	return count > p_item_count.count


func ge(p_item_count: InventoryItemCount) -> bool:
	return self.gt(p_item_count) || self.eq(p_item_count)


static func min(
	item_count_l: InventoryItemCount, item_count_r: InventoryItemCount
) -> InventoryItemCount:
	if item_count_l.less(item_count_r):
		return item_count_l
	return item_count_r


static func inf() -> InventoryItemCount:
	return InventoryItemCount.new(INF)


static func zero() -> InventoryItemCount:
	return InventoryItemCount.new(0)

# TODO: Implement max()
