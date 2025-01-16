extends BaseModel
class_name SkillResource

@export var name: String
@export var target_type: TARGET_TYPE

enum TARGET_TYPE { ENEMIES, PLAYERS }


func _init(p_name: String, p_target_type: TARGET_TYPE) -> void:
	name = p_name
	target_type = p_target_type
