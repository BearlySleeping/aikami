class_name DialogueBox
extends CanvasLayer

@onready var player_avatar: TextureRect = $PlayerAvatar
@onready var npc_avatar: TextureRect = $NPCAvatar
@onready var npc_text: RichTextLabel = $DialoguePanel/NPCText
@onready var talk_input: TextEdit = $DialoguePanel/PlayerInput
@onready var talk_button: Button = $DialoguePanel/TalkButton
@onready var leave_button: Button = $DialoguePanel/LeaveButton


func _ready() -> void:
	visible = false


func clear() -> void:
	visible = false
	talk_input.text = ""
	npc_text.text = ""


func update_npc_portrait(texture: CompressedTexture2D) -> void:
	npc_avatar.texture = texture


func update_npc_text(text: String) -> void:
	npc_text.text = text
	talk_button.disabled = false


func initialize(player: PlayerModel) -> void:
	if player.avatar_path:
		player_avatar.texture = Utils.get_image_texture_from_path(player.avatar_path)
	player_avatar.label_text = player.name


func open(npc: NPCModel) -> void:
	visible = true
	npc_text.text = "..."
	npc_avatar.texture = NPCManager.get_portrait_texture(npc)
	npc_avatar.label_text = npc.name
	talk_button.disabled = true


# called when the TalkButton is pressed
func _on_talk_button_pressed() -> void:
	talk_button.disabled = true
	var text := talk_input.text
	talk_input.text = ""
	npc_text.text = "..."
	talk_button.disabled = true
	await DialogueManager.send_message(text)


# called when the LeaveButton is pressed
func _on_leave_button_pressed() -> void:
	DialogueManager.clear()
