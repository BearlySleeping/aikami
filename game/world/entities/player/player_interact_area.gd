extends Area2D

var _current_npc: NPC


# called when an input is detected
func _input(event: InputEvent) -> void:
	if event.is_action_pressed("interact") and _current_npc:
		DialogueManager.initialize_talk_with_npc(_current_npc.npc_id)


# called when a body enters our collider
func _on_body_entered(body: Node2D) -> void:
	if body is NPC:
		_current_npc = body


# called when a body exits our collider
func _on_body_exited(body: Node2D) -> void:
	if _current_npc == body:
		_current_npc = null
