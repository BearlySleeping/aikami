class_name NPCModel
extends BaseCharacterModel

## Describes the NPC's usual location.
## @optional
var location: String

## Describes the NPC's personality.
## @optional
var personality: String

## Describes the NPC's demeanor and speech patterns.
## @optional
var demeanor_and_speech: String

## Describes the NPC's backstory.
## @optional
var backstory: String

## Describes the NPC's goals.
## @optional
var goals: String

## Describes the NPC's fears.
## @optional
var fears: String

## Describes what the NPC likes.
## @optional
var likes: String

## Describes what the NPC dislikes.
## @optional
var dislikes: String

## Describes the NPC's abilities.
## @optional
var abilities: String

## Describes the NPC's weaknesses.
## @optional
var weaknesses: String

## Describes the NPC's relationships with others.
## @optional
var relationships: String

var current_mood := "default"

var dynamic_data: NPCDynamicModel


func _init(npc_id: String, npc_data: Dictionary) -> void:
	super(npc_id, npc_data)

	location = npc_data.location
	personality = npc_data.personality
	demeanor_and_speech = npc_data.demeanor_and_speech
	backstory = npc_data.backstory
	goals = npc_data.goals
	fears = npc_data.fears
	likes = npc_data.likes
	dislikes = npc_data.dislikes
	abilities = npc_data.abilities
	weaknesses = npc_data.weaknesses
	relationships = npc_data.relationships
