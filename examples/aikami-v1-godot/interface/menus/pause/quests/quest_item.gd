class_name QuestItem extends Button

var quest: QuestModel

@onready var title_label: Label = $TitleLabel
@onready var step_label: Label = $StepLabel


func initialize(quest_data: QuestModel, quest_state: QuestModel) -> void:
	quest = quest_data
	title_label.text = quest_data.title

	if quest_state.is_complete:
		step_label.text = "Completed"
		step_label.modulate = Color.LIGHT_GREEN
	else:
		var step_count: int = quest_data.steps.size()
		var completed_count: int = quest_state.completed_steps.size()
		step_label.text = "quest step: " + str(completed_count) + "/" + str(step_count)
