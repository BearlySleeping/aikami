class_name DialogueHistoryUI
extends PanelContainer

const DIALOGUE_HISTORY_ENTRY = preload(
	"res://interface/dialogue/dialogue_history/dialogue_history_entry.tscn"
)

@onready var dialogue_container: VBoxContainer = %DialogueContainer
@onready var scroll_container: ScrollContainer = $ScrollContainer


func _ready() -> void:
	add_dialogue_entry("NPC Name", "Hello, traveler!")
	add_dialogue_entry("Player", "Hi! What can you tell me about this place?")


func add_dialogue_entry(speaker_name: String, dialogue_text: String) -> void:
	var entry_instance = DIALOGUE_HISTORY_ENTRY.instantiate()
	entry_instance.get_node("NameLabel").text = "[b]" + speaker_name + "[/b]:"
	entry_instance.get_node("TextLabel").text = dialogue_text
	dialogue_container.add_child(entry_instance)
	dialogue_container.move_child(entry_instance, dialogue_container.get_child_count() - 1)
	update_scroll()


func update_scroll() -> void:
	if scroll_container == null:
		return
	scroll_container.scroll_vertical = scroll_container.get_v_scroll_bar().max_value


func clear() -> void:
	dialogue_container.queue_free_children()
