class_name NPCManager

enum PredefinedNPC {
	NONE,
	# Allies:
	ARAGON,
	GANDALF,
	# Enemies:
	ORC,
	TROLL,
}

# Constant dictionary for NPC templates
const PREDEFINED_NPCS: Dictionary = {
	PredefinedNPC.GANDALF:
	{
		"race": Enum.Race.HUMAN,
		"class": Enum.Class.WIZARD,
		"name": "Gandalf the Grey",
		"age": 900,
		"gender": Enum.Gender.MALE,
		"portraits":
		{
			"neutral": "res://assets/npc/gandalf/neutral.webp",
			"happy": "res://assets/npc/gandalf/happy.webp",
			"sad": "res://assets/npc/gandalf/sad.webp",
			"angry": "res://assets/npc/gandalf/angry.webp",
		},
		"unit_sprite_path": "res://assets/npc/gandalf/unit.png",
		"animation_sprite_sheet_path": "res://assets/npc/gandalf/animation_sprite_sheet.png",
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
		"relationships": "Member of the Fellowship of the Ring",
		"voice_type": Enum.VoiceType.MALE_OLD
	},
	PredefinedNPC.ARAGON:
	{
		"race": Enum.Race.HUMAN,
		"class": Enum.Class.FIGHTER,
		"name": "Aragorn",
		"age": 87,
		"gender": Enum.Gender.MALE,
		"portraits":
		{
			"neutral": "res://assets/npc/aragon/neutral.webp",
			"happy": "res://assets/npc/aragon/happy.webp",
			"sad": "res://assets/npc/aragon/sad.webp",
			"angry": "res://assets/npc/aragon/angry.webp",
		},
		"unit_sprite_path": "res://assets/npc/aragon/unit.png",
		"animation_sprite_sheet_path": "res://assets/npc/aragon/animation_sprite_sheet.png",
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
		"relationships": "Loves Arwen, friend of the Fellowship",
		"voice_type": Enum.VoiceType.MALE_DEFAULT
	},
	# Enemies:
	PredefinedNPC.ORC:
	{
		"race": Enum.Race.HALF_ORC,
		"class": Enum.Class.BARBARIAN,
		"name": "Orc Grunt",
		"age": 25,
		"gender": Enum.Gender.MALE,
		"portraits":
		{
			"neutral": "res://assets/npc/orc/neutral.webp",
		},
		"unit_sprite_path": "res://assets/npc/orc/unit.png",
		"animation_sprite_sheet_path": "res://assets/npc/orc/animation_sprite_sheet.png",
		"appearance": ["Muscular", "Green skin", "Crude armor"],
		"location": "Dark caverns, wastelands",
		"personality": "Savage and aggressive",
		"demeanor_and_speech": "Rough and gruff",
		"backstory": "A common soldier in the service of dark forces.",
		"goals": "Serve the dark lord, crush enemies",
		"fears": "Bright light, powerful magic",
		"likes": "Violence, spoils of war",
		"dislikes": "Elves, weakness",
		"abilities": "Brute strength, intimidation",
		"weaknesses": "Low intelligence, disorganized",
		"relationships": "Part of the Orc Horde",
		"voice_type": Enum.VoiceType.MALE_OLD
	},
	PredefinedNPC.TROLL:
	{
		"race": Enum.Race.HALF_ORC,
		"class": Enum.Class.BARBARIAN,
		"name": "Mountain Troll",
		"age": 50,
		"gender": Enum.Gender.MALE,
		"portraits":
		{
			"neutral": "res://assets/npc/troll/neutral.webp",
		},
		"unit_sprite_path": "res://assets/npc/troll/unit.png",
		"animation_sprite_sheet_path": "res://assets/npc/troll/animation_sprite_sheet.png",
		"appearance": ["Massive size", "Rocky skin", "Primitive weapons"],
		"location": "Mountain caves",
		"personality": "Dim-witted but dangerous",
		"demeanor_and_speech": "Slow and brutish",
		"backstory": "Guardians of the dark lord’s strongholds, feared for their immense power.",
		"goals": "Protect the stronghold, destroy intruders",
		"fears": "Fire, sunlight",
		"likes": "Crushing things, eating",
		"dislikes": "Small and fast enemies",
		"abilities": "Overwhelming strength, durability",
		"weaknesses": "Slow movement, low intelligence",
		"relationships": "Servants of dark forces",
		"voice_type": Enum.VoiceType.MALE_OLD
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
	var full_npc_data := npc_data.duplicate()
	Logger.debug("create_npc_model:", full_npc_data)
	return NPCModel.new(npc_id, full_npc_data)


static func get_portrait_path(npc: NPCModel, mood := "neutral") -> String:
	var portrait_path: String = npc.portraits[mood]
	if not portrait_path:
		portrait_path = npc.portraits["neutral"]
		Logger.warn("Portrait path for mood %s not found, using neutral mood" % mood)
	return portrait_path


## TODO: add cache for the textures, add it in the npc_cache? or create a new cache variable?
static func get_portrait_texture(npc: NPCModel, mood := "neutral") -> CompressedTexture2D:
	return load(get_portrait_path(npc, mood))


# Method to save an NPC's dynamic data
static func save_npc_dynamic_data(npc_id: PredefinedNPC) -> void:
	var npc_dynamic_data := get_dynamic_npc_data(npc_id)
	var path := _to_npc_save_path(npc_id)
	SaveManager.save_file(path, npc_dynamic_data)


static func get_dynamic_npc_data(npc_id: PredefinedNPC) -> NPCDynamicModel:
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
