class_name UnitGroup
extends Node2D

const UNIT = preload("res://core/turn-based/units/unit.tscn")

@export var unit_type := Enum.UnitType.PARTY
@export var unit_ids: Array[NPCManager.PredefinedNPC] = []

var units: Array[Unit] = []
var current_index: int = 0


func initialize(p_unit_type: Enum.UnitType, p_unit_ids: Array[NPCManager.PredefinedNPC]) -> void:
	unit_type = p_unit_type
	unit_ids = p_unit_ids
	_populate_units()


func _populate_units() -> void:
	var y_offset := 100

	for i in unit_ids.size():
		var unit: Unit = UNIT.instantiate()
		unit.unit_type = unit_type
		unit.unit_id = unit_ids[i]
		unit.position = Vector2(0, i * y_offset)
		add_child(unit)
		units.append(unit)


func focus_unit(index: int) -> void:
	if index >= 0 and index < units.size():
		_clear_focus()
		units[index].focus()
		current_index = index


func get_current_unit() -> Unit:
	return units[current_index] if current_index < units.size() else null


func _clear_focus() -> void:
	for unit in units:
		unit.unfocus()
