@tool
class_name DialogueUI
extends CanvasLayer

const SAMPLE_TEXT := """Example [b]Text[/b]!!!
[wave]Wavy text[/wave]...
[shake][color=orangered]Shaking text[/color][/shake]"""

@onready var player_avatar: AvatarBox = %PlayerAvatar
@onready var npc_avatar: AvatarBox = %NPCAvatar
@onready var npc_container: NPCContainer = %NPCContainer
@onready var player_container: PlayerContainer = %PlayerContainer


func _ready() -> void:
	if not Engine.is_editor_hint():
		return
	update_npc_text(SAMPLE_TEXT)
	var npc := NPCManager.get_npc(NPCManager.PredefinedNPC.GANDALF)
	show_dialogue(npc)
	SaveManager.initialize()
	initialize(SaveManager.current_player)


func clear() -> void:
	visible = false
	player_container.clear()
	npc_container.clear()
	show_npc_container()


func update_npc_portrait_path(portrait_path: String) -> void:
	npc_avatar.avatar_path = portrait_path


func update_npc_text(text: String) -> void:
	npc_container.text = text


func initialize(player: PlayerModel) -> void:
	if player.avatar_path:
		player_avatar.avatar_path = player.avatar_path
	player_avatar.name_label = player.name


func show_dialogue(npc: NPCModel) -> void:
	visible = true
	process_mode = Node.PROCESS_MODE_ALWAYS
	update_npc_portrait_path(NPCManager.get_portrait_path(npc))
	npc_avatar.name_label = npc.name
	show_npc_container()


func hide_dialogue() -> void:
	visible = false
	process_mode = Node.PROCESS_MODE_DISABLED


func _on_npc_text_container_done_button_pressed() -> void:
	show_player_container()


func _on_player_container_leave_button_pressed() -> void:
	DialogueManager.hide_dialogue()


func _on_player_container_talk_button_pressed(text: String) -> void:
	show_npc_container()
	await DialogueManager.send_message(text)


func show_player_container() -> void:
	player_container.show()
	npc_container.hide()


func show_npc_container() -> void:
	npc_container.text = DialogueManager.NPC_TEXT_PLACEHOLDER
	npc_container.show()
	player_container.hide()
