## QUEST MANAGER - GLOBAL SCRIPT
extends Node

signal quest_updated(quest: QuestModel)

# Constant dictionary for predefined quests
const PREDEFINED_QUESTS: Dictionary = {
	"find-flute":
	{
		"title": "Recover Lost Magical Flute",
		"description":
		"A magical flute was lost in the forest. Find it and return it to the owner.",
		"steps": ["Find the flute", "Return the flute to the owner"],
		"reward_xp": 100,
		"reward_items": [{"item": "flute", "quantity": 1}]
	}
}

var quests: Array[QuestModel]
var current_quests: Array[Dictionary] = []


func _ready() -> void:
	#gather all quests
	gather_quest_data()


func gather_quest_data() -> void:
	# Gather all quest resources and add to quests array
	quests.clear()
	for quest_id: String in PREDEFINED_QUESTS:
		quests.append(QuestModel.new(quest_id, false, [], PREDEFINED_QUESTS[quest_id]))


# Update the status of a quest
func update_quest(title: String, _completed_step: String = "", _is_complete: bool = false) -> void:
	var quest_index: int = get_quest_index_by_title(title)
	if quest_index == -1:
		# Quest was not found - add it to the current quests array
		var new_quest: Dictionary = {
			title = title, is_complete = _is_complete, completed_steps = []
		}

		if _completed_step != "":
			new_quest.completed_steps.append(_completed_step.to_lower())

		current_quests.append(new_quest)
		quest_updated.emit(new_quest)

		# Display a notification that quests was added
		Hud.queue_notification("Quest Started", title)

	else:
		# Quest was found, update it
		var quest := current_quests[quest_index]
		if _completed_step != "" and quest.completed_steps.has(_completed_step) == false:
			quest.completed_steps.append(_completed_step.to_lower())

		quest.is_complete = _is_complete

		quest_updated.emit(quest)

		# Display a notification that quests was updated OR completed
		if quest.is_complete == true:
			Hud.queue_notification("Quest Complete!", title)
			disperse_quest_rewards(find_quest_by_title(title))

		else:
			Hud.queue_notification("Quest Updated", title + ": " + _completed_step)


func disperse_quest_rewards(quest: QuestModel) -> void:
	# Give XP and item rewards to player
	var message: String = str(quest.reward_xp) + "xp"
	PlayerManager.reward_xp(quest.reward_xp)
	for i in quest.reward_items:
		PlayerManager.INVENTORY_DATA.add_item(i.item, i.quantity)
		message += ", " + i.item.name + " x" + str(i.quantity)

	Hud.queue_notification("Quest Rewards Received!", message)


# Provide a quest and return the current quest associated with it
func find_quest(quest: QuestModel) -> Dictionary:
	for q in current_quests:
		if q.title.to_lower() == quest.title.to_lower():
			return q
	return {title = "not found", is_complete = false, completed_steps = [""]}


# Take title and find associated Quest resource
func find_quest_by_title(title: String) -> QuestModel:
	for quest in quests:
		if quest.title.to_lower() == title.to_lower():
			return quest
	return null


# Find quest by title name, and return index in Current Quests array
func get_quest_index_by_title(title: String) -> int:
	for i in current_quests.size():
		if current_quests[i].title.to_lower() == title.to_lower():
			return i
	# Return a -1 if we didn't find a quest with
	# a matching title in our arry
	return -1


func sort_quests() -> void:
	var active_quests: Array[Dictionary] = []
	var completed_quests: Array[Dictionary] = []
	for quest in current_quests:
		if quest.is_complete:
			completed_quests.append(quest)
		else:
			active_quests.append(quest)

	active_quests.sort_custom(sort_quests_ascending)
	completed_quests.sort_custom(sort_quests_ascending)

	current_quests = active_quests
	current_quests.append_array(completed_quests)


func sort_quests_ascending(a: Dictionary, b: Dictionary) -> bool:
	if a.title < b.title:
		return true
	return false
