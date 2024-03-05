@tool
extends Control

signal draggable_dropped(draggable: Draggable, position: Vector2)

const Draggable := preload("inventory_control_draggable.gd")
const DropZone := preload("inventory_control_drop_zone.gd")

var _mouse_inside := false
static var _drop_event := {}


func _process(_delta: float) -> void:
	if _drop_event.is_empty():
		return

	if _drop_event.zone == null:
		Draggable.release()
	else:
		if _drop_event.zone != self:
			return
		_drop_event.zone.draggable_dropped.emit(
			Draggable.grabbed_draggable, get_local_mouse_position() - Draggable.get_grab_offset()
		)
		Draggable.release_on(self)

	_drop_event = {}


func _input(event: InputEvent) -> void:
	if !(event is InputEventMouseButton):
		return

	var mb_event: InputEventMouseButton = event
	if mb_event.is_pressed() || mb_event.button_index != MOUSE_BUTTON_LEFT:
		return

	if Draggable.grabbed_draggable == null:
		return

	if _mouse_inside:
		_drop_event = {zone = self}
	elif _drop_event.is_empty():
		_drop_event = {zone = null}


func activate() -> void:
	mouse_filter = Control.MOUSE_FILTER_PASS


func deactivate() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_mouse_inside = false


func is_active() -> bool:
	return mouse_filter != Control.MOUSE_FILTER_IGNORE


func _ready() -> void:
	mouse_entered.connect(func() -> void: _mouse_inside = true)
	mouse_exited.connect(func() -> void: _mouse_inside = false)
