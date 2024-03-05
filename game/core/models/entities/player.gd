class_name PlayerModel
extends BaseCharacterModel

var avatar_path: String


func to_dict() -> Dictionary:
	return {
		"name": name,
		"race": race,
		"age": age,
		"character_class": character_class,
		"gender": gender,
		"appearance": appearance,
		"avatar_path": avatar_path
	}


func _init(data: Dictionary) -> void:
	name = data.name
	race = data.race
	age = data.age
	character_class = data.character_class
	gender = data.gender
	appearance = data.appearance
	avatar_path = data.get("avatar_path", "")
