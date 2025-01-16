class_name SkillResource
extends BaseModel

enum TargetType { ENEMIES, PLAYERS }

@export var name: String
@export var target_type: TargetType


func _init(p_name: String, p_target_type: TargetType) -> void:
	name = p_name
	target_type = p_target_type
