class_name NPCManager

enum PredefinedNPC {
	FRODO,
	ARAGON,
	GANDALF,
}

# Constant dictionary for NPC templates
const PREDEFINED_NPCS: Dictionary = {
	PredefinedNPC.FRODO:
	{
		"race": Enum.Race.HALFLING,
		"class": Enum.Class.ROGUE,
		"name": "Frodo Baggins",
		"age": 50,
		"gender": Enum.Gender.MALE,
		"portraits": ["default.png"],
		"appearance": ["Short", "Curly hair"],
		"location": "The Shire",
		"personality": "Brave and kind",
		"demeanor_and_speech": "Polite and thoughtful",
		"backstory": "Bearer of the One Ring, tasked with its destruction.",
		"goals": "Destroy the One Ring",
		"fears": "Corruption by the Ring",
		"likes": "Peace, friends",
		"dislikes": "Evil, the Ring's corruption",
		"abilities": "Stealth, resilience",
		"weaknesses": "The Ring's influence",
		"relationships": "Friend of Sam, Merry, and Pippin"
	},
	PredefinedNPC.GANDALF:
	{
		"race": Enum.Race.HUMAN,
		"class": Enum.Class.WIZARD,
		"name": "Gandalf the Grey",
		"age": -1,
		"gender": Enum.Gender.MALE,
		"portraits": ["default.png", "anger.png"],
		"appearance": ["Tall", "Grey robe", "Long white beard"],
		"location": "Middle-earth",
		"personality": "Wise and powerful",
		"demeanor_and_speech": "Commanding and eloquent",
		"backstory": "A wizard sent to combat the threat of Sauron.",
		"goals": "Aid in the defeat of Sauron",
		"fears": "The rise of darkness",
		"likes": "Pipe-weed, hobbits",
		"dislikes": "Evil, folly",
		"abilities": "Magic, wisdom",
		"weaknesses": "Physical form limitations",
		"relationships": "Member of the Fellowship of the Ring"
	},
	PredefinedNPC.ARAGON:
	{
		"race": Enum.Race.HUMAN,
		"class": Enum.Class.FIGHTER,
		"name": "Aragorn",
		"age": 87,
		"gender": Enum.Gender.MALE,
		"portraits": ["default.png"],
		"appearance": ["Tall", "Rugged"],
		"location": "Rohan, Gondor",
		"personality": "Brave and noble",
		"demeanor_and_speech": "Leader-like and inspiring",
		"backstory": "Heir to the throne of Gondor, leader of the Fellowship after Gandalf's fall.",
		"goals": "Defeat Sauron, reclaim the throne",
		"fears": "Failure to protect the free peoples",
		"likes": "Peace, nature",
		"dislikes": "Tyranny, oppression",
		"abilities": "Swordsmanship, leadership",
		"weaknesses": "Heavy burden of destiny",
		"relationships": "Loves Arwen, friend of the Fellowship"
	},
}

# Cache for instantiated NPCs
static var npc_cache: Dictionary


static func to_predefined_npc_name(npc_id: PredefinedNPC) -> String:
	return PredefinedNPC.keys()[npc_id].to_lower()


# Function to get or create an NPC
static func get_npc(npc_id: PredefinedNPC) -> NPCModel:
	if npc_cache and npc_cache.has(npc_id):
		return npc_cache[npc_id]
	var npc_id_str: String = to_predefined_npc_name(npc_id)
	assert(PREDEFINED_NPCS.has(npc_id), "PREDEFINED_NPCS does include %s" % npc_id_str)

	var npc := create_npc_model(npc_id_str, PREDEFINED_NPCS[npc_id])
	if npc_cache:
		npc_cache[npc_id] = npc
	else:
		npc_cache = {npc_id: npc}
	return npc


static func create_npc_model(npc_id: String, npc_data: Dictionary) -> NPCModel:
	var portraits: Array = npc_data["portraits"]
	var portrait_paths := portraits.map(
		func(portrait: String) -> String: return (
			"res://assets/npc/%s/portraits/%s" % [npc_id, portrait]
		)
	)

	var full_npc_data := npc_data.duplicate()
	full_npc_data["portrait_paths"] = portrait_paths
	Logger.debug("create_npc_model:", full_npc_data)
	return NPCModel.new(npc_id, full_npc_data)


## TODO: add cache for the textures, add it in the npc_cache? or create a new cache variable?
static func get_portrait_texture(npc: NPCModel, mood := "default") -> CompressedTexture2D:
	return load(npc.get_portrait_path(mood))


# Method to save an NPC's dynamic data
static func save_npc_dynamic_data(npc_id: PredefinedNPC) -> void:
	var npc_dynamic_data := get_dynamic_data(npc_id)
	var path := _to_npc_save_path(npc_id)
	SaveManager.save_file(path, npc_dynamic_data)


static func get_dynamic_data(npc_id: PredefinedNPC) -> NPCDynamicModel:
	var npc := get_npc(npc_id)  # This ensures the NPC model exists
	if npc.dynamic_data:
		return npc.dynamic_data
	# Load the dynamic data from disk
	var path := _to_npc_save_path(npc_id)
	var response := SaveManager.load_file(path)
	var dynamic_data := NPCDynamicModel.new(response[0] if response[0] else {})
	npc.dynamic_data = dynamic_data
	return dynamic_data


static func _to_npc_save_path(npc_id: PredefinedNPC) -> String:
	# Example: Returns a unique file path for each NPC's dynamic data
	return "npcs/%s_dynamic_data.save" % to_predefined_npc_name(npc_id)
