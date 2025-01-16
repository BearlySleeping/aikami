@icon("res://world/entities/npc/icons/npc_behavior.svg")
class_name NPCBehavior extends Node2D

var npc: NPC


func _ready() -> void:
	var parent := get_parent()
	if parent is NPC:
		npc = parent as NPC
		npc.do_behavior_enabled.connect(start)


func start() -> void:
	pass
