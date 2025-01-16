class_name QuestsUI extends Control

const QUEST_ITEM: PackedScene = preload("res://interface/menus/pause/quests/quest_item.tscn")
const QUEST_STEP_ITEM: PackedScene = preload(
	"res://interface/menus/pause/quests/quest_step_item.tscn"
)

@onready var quest_item_container: VBoxContainer = $ScrollContainer/MarginContainer/VBoxContainer
@onready var details_container: VBoxContainer = $VBoxContainer
@onready var title_label: Label = $VBoxContainer/TitleLabel
@onready var description_label: Label = $VBoxContainer/DescriptionLabel


func _ready() -> void:
	clear_quest_details()
	visibility_changed.connect(_on_visible_changed)


func _on_visible_changed() -> void:
	for i in quest_item_container.get_children():
		i.queue_free()

	clear_quest_details()

	if visible == true:
		QuestManager.sort_quests()
		for quest in QuestManager.quests:
			var quest_data: QuestModel = QuestManager.find_quest_by_title(quest.title)
			if quest_data == null:
				continue
			var new_q_item: QuestItem = QUEST_ITEM.instantiate()
			quest_item_container.add_child(new_q_item)
			new_q_item.initialize(quest_data, quest)
			new_q_item.focus_entered.connect(update_quest_details.bind(new_q_item.quest))


func update_quest_details(quest: QuestModel) -> void:
	clear_quest_details()

	title_label.text = quest.title
	description_label.text = quest.description

	var quest_save := quest

	for step in quest.steps:
		var new_step: QuestStepItem = QUEST_STEP_ITEM.instantiate()
		var step_is_complete: bool = false
		if quest_save.title != "not found":
			step_is_complete = quest_save.completed_steps.has(step.to_lower())
		details_container.add_child(new_step)
		new_step.initialize(step, step_is_complete)


func clear_quest_details() -> void:
	title_label.text = ""
	description_label.text = ""
	for c in details_container.get_children():
		if c is QuestStepItem:
			c.queue_free()
