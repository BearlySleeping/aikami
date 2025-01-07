class_name QuestItem extends Button

var quest: QuestModel

@onready var title_label: Label = $TitleLabel
@onready var step_label: Label = $StepLabel


func initialize(q_data: QuestModel, q_state: Dictionary) -> void:
	quest = q_data
	title_label.text = q_data.title

	if q_state.is_complete:
		step_label.text = "Completed"
		step_label.modulate = Color.LIGHT_GREEN
	else:
		var step_count: int = q_data.steps.size()
		var completed_count: int = q_state.completed_steps.size()
		step_label.text = "quest step: " + str(completed_count) + "/" + str(step_count)
