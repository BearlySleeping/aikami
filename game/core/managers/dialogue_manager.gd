extends Node

const BASE_RULES := [
	"You are a NPC in a fantasy RPG engaging me in conversation.",
	"You should initiate the conversation with the player.",
	"Don't mention that you are an AI or that this is a game.",
	"Your responses should consist solely of your character's dialogue or implied actions, without prefixing them with your name or any identifiers.",
	"Do NOT add '{npc_name}: ' at the beginning.",
	"Avoid breaking character or mentioning modern or out-of-context elements."
]

var dialogue_scene := preload("res://interface/dialogue/dialogue_box.tscn")
var dialogue_box: DialogueBox
var audio_stream_player: AudioStreamPlayer

var _stored_streamed_audio: PackedByteArray
var _stream := AudioStreamMP3.new()

static var _current_npc_id: NPCManager.PredefinedNPC = NPCManager.PredefinedNPC.NONE
static var _messages: PackedStringArray = []
static var _current_mood := "default"


func _ready() -> void:
	SignalManager.text_chunk_added.connect(_on_text_chunk_added)
	SignalManager.voice_chunk_added.connect(_on_voice_chunk_added)
	audio_stream_player = AudioStreamPlayer.new()
	audio_stream_player.finished.connect(_on_audio_stream_player_finished)
	add_child(audio_stream_player)


func _on_text_chunk_added(text: String) -> void:
	AIManager.generate_voice_with_text_chunk(text)
	var exiting_text := dialogue_box.npc_container.text
	if exiting_text == "...":
		dialogue_box.update_npc_text(text)
	else:
		dialogue_box.update_npc_text(exiting_text + text)


func _on_voice_chunk_added(chunk: PackedByteArray) -> void:
	Logger.debug("_on_voice_chunk_added:chunk size", chunk.size())
	_stored_streamed_audio.append_array(chunk)
	if audio_stream_player.playing:
		return
	_play_chunk()


func _on_audio_stream_player_finished() -> void:
	Logger.debug("_on_audio_stream_player_finished")
	_play_chunk()


func _play_chunk() -> void:
	if _stored_streamed_audio.is_empty():
		return
	_stream.data = _stored_streamed_audio
	audio_stream_player.set_stream(_stream)
	audio_stream_player.play()
	_stored_streamed_audio.clear()


class NPCDialogueResponseModel:
	var text_response: String
	var not_important_action: String
	var action: String
	var mood: String

	func _init(data: Dictionary) -> void:
		text_response = data.text_response
		not_important_action = data.get("not_important_action", "")
		action = data.get("action", "")
		mood = data.get("mood", "")


class NPCDialogueRequestModel:
	var messages: PackedStringArray
	var npc: NPCModel
	var actions: PackedStringArray


func initialize_talk_with_npc(npc_id: NPCManager.PredefinedNPC) -> void:
	if Global.dialogue_active or npc_id == _current_npc_id:
		return
	Global.dialogue_active = true
	if !dialogue_box:
		dialogue_box = dialogue_scene.instantiate()
		get_tree().root.add_child(dialogue_box)
		dialogue_box.initialize(SaveManager.current_player)
	_current_npc_id = npc_id
	_messages = []
	_current_mood = "default"
	dialogue_box.open(NPCManager.get_npc(npc_id))
	var first_prompt := get_first_message_prompt()
	await send_message(first_prompt)


func clear() -> void:
	Global.dialogue_active = false
	dialogue_box.clear()
	var messages_amount := _messages.size()
	# Only save if player has talked
	if messages_amount > 2:
		await save_dialogue()
	_messages = []
	@warning_ignore("int_as_enum_without_cast")
	@warning_ignore("int_as_enum_without_match")
	_current_npc_id = NPCManager.PredefinedNPC.NONE


func get_first_message_prompt() -> String:
	assert(_current_npc_id != NPCManager.PredefinedNPC.NONE, "_current_npc_id is not defined")
	var npc := NPCManager.get_npc(_current_npc_id)
	var player := SaveManager.current_player
	var dynamic_npc_data := NPCManager.get_dynamic_data(_current_npc_id)

	var prompts := PackedStringArray()

	# Context Section
	prompts.append("--- Context ---")
	prompts.append_array(BASE_RULES)

	# NPC Info Section
	prompts.append("--- Info about you, the NPC ---")
	prompts.append_array(_to_static_npc_info(npc))

	# Player Info Section
	prompts.append("--- Info about the Player ---")
	prompts.append_array(to_player_info(player))

	# Dynamic NPC Info / Memory Section
	prompts.append("--- Memory / Extra Info ---")
	prompts.append_array(to_dynamic_npc_info(dynamic_npc_data))

	return "\n".join(prompts)


func _to_static_npc_info(npc: NPCModel) -> PackedStringArray:
	var info := PackedStringArray()
	# Basic NPC attributes
	if npc.appearance:
		info.append("appearance: %s" % ", ".join(npc.appearance))
	if npc.personality:
		info.append("personality: %s" % npc.personality)
	if npc.location:
		info.append("location: %s" % npc.location)

	# Enhanced NPC attributes
	if npc.goals:
		info.append("goals: %s." % npc.goals)
	if npc.fears:
		info.append("fears: %s." % npc.fears)
	if npc.likes:
		info.append("likes: %s" % npc.likes)
	if npc.dislikes:
		info.append("dislikes: %s" % npc.dislikes)
	if npc.abilities:
		info.append("abilities: %s" % npc.abilities)
	if npc.weaknesses:
		info.append("weaknesses: %s." % npc.weaknesses)
	return info


func to_player_info(player: PlayerModel) -> PackedStringArray:
	var info := PackedStringArray()
	# Player attributes
	info.append("gender: %s" % player.gender)
	info.append("race: %s" % player.race)
	info.append("class: %s" % player.character_class)
	info.append("age: %s" % player.age)
	if player.appearance:
		info.append("appearance: %s" % ", ".join(player.appearance))
	return info


func to_dynamic_npc_info(dynamic_npc_data: NPCDynamicModel) -> PackedStringArray:
	var info := PackedStringArray()
	var time := TimeManager.get_total_game_time()

	info.append("It is %s" % TimeManager.to_calender(time))

	var last_time_spoke_at := dynamic_npc_data.last_time_spoke_at
	if last_time_spoke_at == -1:
		info.append("You have not talked to the player before.")
	else:
		var last_time_spoke := TimeManager.to_current_time_difference(last_time_spoke_at)
		info.append("Last spoke: %s" % last_time_spoke)
		if not dynamic_npc_data.recollections.is_empty():
			info.append("Remember: '%s'" % ", ".join(dynamic_npc_data.recollections))
	return info


func send_message(prompt: String) -> void:
	assert(_current_npc_id != NPCManager.PredefinedNPC.NONE, "_current_npc_id is not defined")
	var npc := NPCManager.get_npc(_current_npc_id)
	Logger.info("_send_message", prompt)
	_messages.append(prompt)

	var request := (
		BaseTextAPI
		. CallFunctionRequestModel
		. new(
			"npc_dialogue",
			"Process NPC dialogue inputs and generate dialogue outputs",
			_messages,
			[
				BaseTextAPI.FieldModel.new(
					"text_response", "string", "The NPC's verbal response", true
				),
				BaseTextAPI.FieldModel.new(
					"action",
					"array",
					"A list of actions the NPC can take",
					false,
					["continue_conversation", "end_conversation", "attack_player"]
				),
				BaseTextAPI.FieldModel.new(
					"mood", "string", "The NPC's current mood", false, npc.get_available_moods()
				),
			],
			true,
		)
	)

	var response := await AIManager.call_text_function(request)
	if response.error:
		return clear()
	var npc_dialogue := NPCDialogueResponseModel.new(response.data)

	var text := npc_dialogue.text_response
	var mood := npc_dialogue.mood
	var action := npc_dialogue.action
	if action and action == "end_conversation":
		await clear()
		return

	if mood and mood != _current_mood:
		_current_mood = mood
		dialogue_box.update_npc_portrait(NPCManager.get_portrait_texture(npc, mood))

	_messages.append(text)
	#dialogue_box.update_npc_text(text)


func save_dialogue() -> void:
	assert(_current_npc_id != NPCManager.PredefinedNPC.NONE, "_current_npc_id is not defined")

	var prompt := _to_generate_summary_prompt()
	Logger.info("generate_summary:prompt", prompt)
	var request := BaseTextAPI.CallBasicRequestModel.new([prompt], false)

	var response := await AIManager.call_text_basic(request)
	if response.error:
		return
	var text := response.text
	Logger.info("generate_summary:response", text)
	var new_recollections: Array = text.split(",", false)
	var dynamic_npc_data := NPCManager.get_dynamic_data(_current_npc_id)
	dynamic_npc_data.recollections = new_recollections.map(
		func(recollection: String) -> String: return recollection.strip_edges()
	)
	dynamic_npc_data.last_time_spoke_at = TimeManager.get_total_in_game_minutes()
	NPCManager.save_npc_dynamic_data(_current_npc_id)


func _to_generate_summary_prompt() -> String:
	var actual_conversation := _messages.slice(1, _messages.size())  # Adjust indices as needed
	Logger.info("generate_summary: actual_conversation", actual_conversation)
	var message_list := PackedStringArray()
	for i in range(actual_conversation.size()):
		var role := "player" if i % 2 == 0 else "npc"
		message_list.append(role + ": " + actual_conversation[i])

	var current_conversation_str := "\n".join(message_list)
	var prompts := PackedStringArray()
	var npc := NPCManager.get_npc(_current_npc_id)
	var player := SaveManager.current_player
	var dynamic_npc_data := NPCManager.get_dynamic_data(_current_npc_id)
	var recollections := dynamic_npc_data.recollections

	var task_intro := (
		"You are an NPC in a fantasy RPG. Reflect on the actual conversation below and summarize it into key points,"
		+ " focusing only on new insights and details explicitly mentioned. Summaries should directly relate to this interaction or reiterate"
		+ " relevant details from previous notes if they are referenced again. Avoid assumptions or attributing traits not directly mentioned"
		+ " in the conversation or previous notes. Each key point should be separated by a comma."
	)

	prompts.append("--- Task ---")
	prompts.append(task_intro)

	# NPC Info Section
	prompts.append("--- Info about you, the NPC ---")
	prompts.append_array(_to_static_npc_info(npc))

	# Player Info Section
	prompts.append("--- Info about the Player ---")
	prompts.append_array(to_player_info(player))

	# Dynamic NPC Info / Memory Section
	prompts.append("--- Memory / Extra Info ---")
	prompts.append_array(to_dynamic_npc_info(dynamic_npc_data))

	# Providing clarity that the conversation is the focus for summary generation
	prompts.append("--- Actual Conversation ---")
	prompts.append(current_conversation_str)

	if recollections.is_empty():
		prompts.append("--- Guidance for Summary Generation (Do Not Repeat) ---")
		prompts.append(
			(
				"Examples: 'Learned player is called Bob. "
				+ "Encountered player at the crossroads, player expressed a desire to learn magic, "
				+ "Discovered player's fear of dark forests, "
				+ "I revealed the secret path to the enchanted grove, "
				+ "We shared tales of ancient dragons.' "
				+ "These are examples. Generate new points based on the actual conversation."
			)
		)

	else:
		prompts.append("--- Previous Notes ---")
		prompts.append(",".join(recollections))

	return "\n".join(prompts)
