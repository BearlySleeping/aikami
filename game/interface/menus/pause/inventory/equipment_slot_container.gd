@tool
extends PanelContainer

@export var texture: Texture2D = null:
	set(value):
		if value == sprite:
			return
		texture = value
		_set_sprite_texture()

@export var equipped_slot_type := Enum.EquippedSlotType.NONE:
	set(value):
		if value == equipped_slot_type:
			return
		equipped_slot_type = value
		update_configuration_warnings()

@onready var sprite: Sprite2D = $Sprite2D


func _ready() -> void:
	_set_sprite_texture()


func _set_sprite_texture() -> void:
	if sprite == null:
		return
	sprite.texture = texture
	update_configuration_warnings()


func _get_configuration_warnings() -> PackedStringArray:
	var warnings := PackedStringArray()

	if texture == null:
		warnings.append("Please set `texture` to a non-empty value.")

	if equipped_slot_type == Enum.EquippedSlotType.NONE:
		warnings.append("Please set `equipped_slot_type` to a non-`NONE` value.")

	return warnings
