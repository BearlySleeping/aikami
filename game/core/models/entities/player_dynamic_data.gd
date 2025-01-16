class_name PlayerDynamicModel
extends BaseDynamicCharacter

var quest_log: Array = []


func _init(data: Dictionary) -> void:
	super(data)


func to_dict() -> Dictionary:
	var dict := super()
	if quest_log and not quest_log.is_empty():
		dict.quest_log = quest_log
	return dict
