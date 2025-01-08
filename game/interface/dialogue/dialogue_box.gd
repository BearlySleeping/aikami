@tool
class_name DialogueBox
extends CanvasLayer

const sample_text := "Example [b]Text[/b]!!!\n[wave]Wavy text[/wave]...\n[shake][color=orangered]Shaking text[/color][/shake]"

@onready var player_avatar: AvatarBox = %PlayerAvatar
@onready var npc_avatar: AvatarBox = %NPCAvatar
@onready var npc_container: NPCContainer = %NPCContainer
@onready var player_container: PlayerContainer = %PlayerContainer


func _ready() -> void:
	if not Engine.is_editor_hint():
		return
	update_npc_text(sample_text)
	var npc := NPCManager.get_npc(NPCManager.PredefinedNPC.GANDALF)
	open(npc)
	SaveManager.initialize()
	initialize(SaveManager.current_player)


func clear() -> void:
	visible = false
	player_container.clear()
	npc_container.clear()


func update_npc_portrait(texture: CompressedTexture2D) -> void:
	npc_avatar.set_texture(texture)


func update_npc_text(text: String) -> void:
	npc_container.text = text


func initialize(player: PlayerModel) -> void:
	if player.avatar_path:
		player_avatar.avatar_path = player.avatar_path
	player_avatar.name_label = player.name


func open(npc: NPCModel) -> void:
	visible = true
	npc_container.text = "..."
	npc_avatar.avatar_path = npc.portrait_sprite_path
	npc_avatar.name_label = npc.name
	update_npc_portrait(NPCManager.get_portrait_texture(npc))


func _on_npc_text_container_done_button_pressed() -> void:
	npc_container.hide()
	player_container.show()


func _on_player_container_leave_button_pressed() -> void:
	DialogueManager.clear()


func _on_player_container_talk_button_pressed(text: String) -> void:
	player_container.hide()
	npc_container.show()
	npc_container.text = "..."
	await DialogueManager.send_message(text)
