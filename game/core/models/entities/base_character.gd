class_name BaseCharacterModel
extends BaseModel

var id: String

var race: Enum.Race
var character_class: Enum.Class
var name: String
var age: int

## @optional
var gender: Enum.Gender

## @optional
var appearance: PackedStringArray

var animation_sprite_sheet_path: String

# The key is the mood and the value is the path to the image
# neutral mood is required
var portraits: Dictionary


func get_available_moods() -> PackedStringArray:
	return portraits.keys()


func _init(character_id: String, data: Dictionary) -> void:
	id = character_id
	race = data.race
	character_class = data.class
	name = data.name
	age = data.age
	gender = data.gender
	appearance = data.appearance
	animation_sprite_sheet_path = data.animation_sprite_sheet_path
	portraits = data.portraits
