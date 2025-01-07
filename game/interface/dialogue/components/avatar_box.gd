@tool
class_name AvatarBox
extends AspectRatioContainer

@onready var sprite: Sprite2D = %AvatarSprite
@onready var label: Label = %AvatarLabel


@export var name_label := "":
	set(value):
		if value == name_label:
			return
		name_label = value
		_set_label()

@export var avatar_path := "":
	set(value):
		if value == avatar_path:
			return
		avatar_path = value
		_set_avatar()


func _ready() -> void:
	_set_label()


func set_texture(texture: Texture2D) -> void:
	sprite.texture = texture

func _set_label() -> void:
	if label != null:
		label.text = name_label
	update_configuration_warnings()

func _set_avatar() -> void:
	if sprite == null:
		return
	set_texture(null)
	set_texture(Utils.get_image_texture_from_path(avatar_path, 100))
	update_configuration_warnings()


func _get_configuration_warnings() -> PackedStringArray:
	var warnings := PackedStringArray()

	if name_label == "":
		warnings.append("Please set `name_label` to a non-empty value.")

	if name_label.length() >= 100:
		warnings.append("`name_label` should be less than 100 characters long.")

	if avatar_path == "":
		warnings.append("Please set `avatar_path` to a non-empty value.")

	return warnings
