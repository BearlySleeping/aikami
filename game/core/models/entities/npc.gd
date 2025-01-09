class_name NPCDynamicModel
extends BaseDynamicCharacter

## Timestamp in game minutes when the npc last spoke with the player
## if -1, the npc has never spoke to the player before
var last_time_spoke_at: int

## Things the npc remember, example player's name, any memorable things said in previous conversations.
## Example ["Player's name is Sonny", "Player insulted me", "Player's favorite food is pie", "You revealed that you are a wizard"]
var recollections: PackedStringArray

var relationship_level_with_player: int


func _init(data: Dictionary) -> void:
	super(data)
	last_time_spoke_at = data.get("last_time_spoke_at", -1)
	recollections = data.get("recollections", [])
	relationship_level_with_player = data.get("relationship_level_with_player", 50)


func to_dict() -> Dictionary:
	var dict := super()
	if last_time_spoke_at != -1:
		dict.last_time_spoke_at = last_time_spoke_at
	if not recollections.is_empty():
		dict.recollections = recollections
	if relationship_level_with_player != 50:
		dict.relationship_level_with_player = relationship_level_with_player
	return dict
