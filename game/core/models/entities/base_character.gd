class_name BaseCharacterModel
extends BaseModel

var id: String

var race: Enum.Race
var character_class: Enum.Class
var name: String
var age: int

## The absolute paths to the portraits of the character.[br]
## The filename must be [enum Enum.Mood] + ".png/jpg"
## And it has to include at least the default mood.[br]
## @example
## [codeblock]
## avatar_paths = [
##    "res://assets/avatars/elf/legolas/default.png",
##    "res://assets/avatars/elf/legolas/angry.png",
##    ]
## [/codeblock][br]
## @required
var portrait_paths: PackedStringArray

## @optional
var gender: Enum.Gender

## @optional
var appearance: PackedStringArray


func get_available_moods() -> PackedStringArray:
	var moods: PackedStringArray = []

	for portrait_path in portrait_paths:
		var mood := portrait_path.get_file().split(".")[0]
		moods.append(mood)
	return moods


func get_portrait_path(mood := "default") -> String:
	for portrait_path in portrait_paths:
		var portrait_mood := portrait_path.get_file().split(".")[0]
		if portrait_mood == mood:
			return portrait_path
	assert(false, "portrait_paths does not have mood %s" % mood)
	return ""


func _init(character_id: String, data: Dictionary) -> void:
	id = character_id
	race = data.race
	character_class = data.class
	name = data.name
	age = data.age
	gender = data.gender
	appearance = data.appearance
	portrait_paths = data.portrait_paths
