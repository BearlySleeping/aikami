class_name QuestModel
extends BaseModel

var id: int
var quest_name: String
var quest_description: String
var quest_objective: String

var objective_completed: bool = false:
	set(value):
		objective_completed = value
	get:
		return objective_completed


func update() -> void:
	objective_completed = true


func start() -> void:
	pass


func complete() -> void:
	pass
