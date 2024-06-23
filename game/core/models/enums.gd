class_name Enum

enum Gender { MALE, FEMALE, UNKNOWN }

enum ItemType { CONSUMABLE, WEAPON, ARMOR, QUEST }

enum WeaponType { SWORD }

enum ArmorType {
	HELMET,
}

enum Race {
	HUMAN,
	ELF,
	DWARF,
	HALFLING,
	GNOME,
	DRAGONBORN,
	HALF_ELF,
	HALF_ORC,
	TIEFLING,
}

enum Class {
	BARBARIAN,
	BARD,
	CLERIC,
	DRUID,
	FIGHTER,
	MONK,
	PALADIN,
	RANGER,
	ROGUE,
	SORCERER,
	WARLOCK,
	WIZARD,
}

enum EquippedSlot {
	HEAD,
	BODY,
	LEGS,
	FEET,
	HANDS,
	RING,
}

enum Mood {
	DEFAULT,
	SAD,
	HAPPY,
	ANGRY,
	EXCITED,
	SURPRISED,
	NEUTRAL,
	CONFUSED,
	CALM,
	CONTENT,
	DISAPPOINTED,
	TIRED,
	FEARFUL,
	PROUD,
	HOPEFUL,
	RELIEVED,
	GRATEFUL,
	INDIFFERENT,
	CURIOUS,
	AMUSED,
}

const MOOD_MAP := {
	Mood.DEFAULT: "default",
	Mood.SAD: "sad",
	Mood.HAPPY: "happy",
	Mood.ANGRY: "angry",
	Mood.EXCITED: "excited",
	Mood.SURPRISED: "surprised",
	Mood.NEUTRAL: "neutral",
	Mood.CONFUSED: "confused",
	Mood.CALM: "calm",
	Mood.CONTENT: "content",
	Mood.DISAPPOINTED: "disappointed",
	Mood.TIRED: "tired",
	Mood.FEARFUL: "fearful",
	Mood.PROUD: "proud",
	Mood.HOPEFUL: "hopeful",
	Mood.RELIEVED: "relieved",
	Mood.GRATEFUL: "grateful",
	Mood.INDIFFERENT: "indifferent",
	Mood.CURIOUS: "curious",
	Mood.AMUSED: "amused",
}


## Convert mood enum to string representation
static func mood_enum_to_string(mood: Mood) -> String:
	return Mood.keys()[mood].to_lower()


## Convert mood string to enum value
static func mood_string_to_enum(mood_string: String) -> Mood:
	var mood_keys := Mood.keys()
	var mood_key_index := mood_keys.find(mood_string.to_upper())
	if mood_key_index != -1:
		return mood_keys[mood_key_index]

	printerr("Warning: Unrecognized mood string: '%s'" % mood_string)
	return Mood.DEFAULT
