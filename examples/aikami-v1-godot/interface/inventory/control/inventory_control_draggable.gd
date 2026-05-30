@tool
extends Control

signal grabbed(position: Vector2)
signal dropped(zone: DropZone, position: Vector2)

const Draggable := preload("inventory_control_draggable.gd")
const DropZone := preload("inventory_control_drop_zone.gd")

# Embedded Windows are placed on layer 1024. CanvasItems on layers 1025 and higher appear in front of embedded windows.
# (https://docs.godotengine.org/en/stable/classes/class_canvaslayer.html#description)
const EMBEDDED_WINDOWS_LAYER := 1024

var drag_preview: Control
var drag_z_index := 1

var _preview_canvas_layer := CanvasLayer.new()

static var draggable_grabbed: Signal = (
	(func() -> Signal: return _add_static_signal("draggable_grabbed")).call()
)

static var draggable_dropped: Signal = (
	(func() -> Signal: return _add_static_signal("draggable_dropped")).call()
)

static var grabbed_draggable: Draggable = null
static var _grab_offset: Vector2


static func grab(draggable: Draggable) -> void:
	grabbed_draggable = draggable
	_grab_offset = draggable.get_global_mouse_position() - draggable.global_position

	draggable.mouse_filter = Control.MOUSE_FILTER_IGNORE
	draggable.grabbed.emit(_grab_offset)
	draggable_grabbed.emit(draggable, _grab_offset)
	draggable.drag_start()


static func release() -> void:
	_drop(null)


static func release_on(zone: DropZone) -> void:
	_drop(zone)


# Somewhat hacky way to do static signals:
# https://stackoverflow.com/questions/77026156/how-to-write-a-static-event-emitter-in-gdscript/77026952#77026952
static func _add_static_signal(signal_name: String) -> Signal:
	var object := Draggable as Object
	if object.has_user_signal(signal_name):
		return object[signal_name]
	object.add_user_signal(signal_name)
	return Signal(object, signal_name)


static func _drop(zone: DropZone) -> void:
	var draggable := grabbed_draggable
	var grab_offset := _grab_offset
	grabbed_draggable = null
	_grab_offset = Vector2.ZERO
	draggable.mouse_filter = Control.MOUSE_FILTER_PASS
	var local_drop_position := Vector2.ZERO
	if zone:
		local_drop_position = zone.get_local_mouse_position() - grab_offset

	draggable.drag_end()
	draggable.dropped.emit(zone, local_drop_position)
	draggable_dropped.emit(draggable, zone, local_drop_position)


static func get_grab_offset() -> Vector2:
	return _grab_offset


func drag_start() -> void:
	if !is_instance_valid(drag_preview):
		return

	drag_preview.mouse_filter = Control.MOUSE_FILTER_IGNORE
	drag_preview.global_position = _get_global_preview_position()
	get_viewport().add_child(_preview_canvas_layer)
	_preview_canvas_layer.add_child(drag_preview)
	# Make sure the preview is drawn above the embedded windows
	_preview_canvas_layer.layer = EMBEDDED_WINDOWS_LAYER + 1


func _get_global_preview_position() -> Vector2:
	@warning_ignore("static_called_on_instance")
	return (
		get_global_transform_with_canvas().origin + get_local_mouse_position() - get_grab_offset()
	)


func drag_end() -> void:
	if !is_instance_valid(drag_preview):
		return

	_preview_canvas_layer.remove_child(drag_preview)
	_preview_canvas_layer.get_parent().remove_child(_preview_canvas_layer)
	drag_preview.mouse_filter = Control.MOUSE_FILTER_PASS


func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE && is_instance_valid(_preview_canvas_layer):
		_preview_canvas_layer.queue_free()


func _process(_delta: float) -> void:
	if is_instance_valid(drag_preview):
		drag_preview.global_position = _get_global_preview_position()


func _gui_input(event: InputEvent) -> void:
	if !(event is InputEventMouseButton):
		return

	var mb_event: InputEventMouseButton = event
	if mb_event.button_index != MOUSE_BUTTON_LEFT:
		return

	if mb_event.is_pressed():
		@warning_ignore("static_called_on_instance")
		grab(self)


func is_dragged() -> bool:
	return grabbed_draggable == self
