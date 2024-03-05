@tool
class_name NPC
extends CharacterBody2D

@export var npc_id: NPCManager.PredefinedNPC:
	set(value):
		if npc_id == value:
			return
		npc_id = value
		update_sprite(value)

@onready var sprite_2d: Sprite2D = $Sprite2D


func update_sprite(id: NPCManager.PredefinedNPC) -> void:
	var npc_data := NPCManager.get_npc(id)
	if not npc_data:
		return push_error("NPC data not found for npc_id: ", id)
	var portrait_path := npc_data.get_portrait_path()
	await ready
	sprite_2d.texture = load(portrait_path)
