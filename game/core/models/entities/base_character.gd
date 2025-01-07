class_name BaseCharacterModel
extends BaseModel

var id: String

var race: Enum.Race
var character_class: Enum.Class
var name: String
var age: int

var portrait_sprite_path: String

## @optional
var gender: Enum.Gender

## @optional
var appearance: PackedStringArray

var animation_sprite_sheet_path: String

var moods_map: Dictionary


func get_available_moods() -> PackedStringArray:
	return moods_map.keys()


func _init(character_id: String, data: Dictionary) -> void:
	id = character_id
	race = data.race
	character_class = data.class
	name = data.name
	age = data.age
	gender = data.gender
	appearance = data.appearance
	portrait_sprite_path = data.portrait_sprite_path
	animation_sprite_sheet_path = data.animation_sprite_sheet_path
