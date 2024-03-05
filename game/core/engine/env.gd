class_name Env
extends Node

# Dictionary to store the environment variables
static var _env_vars := {}
static var _loaded := false


static func _load_env_vars() -> void:
	var file := FileAccess.open("res://.env", FileAccess.READ)
	if not file:
		return
	while file.get_position() < file.get_length():
		var line := file.get_line()
		var key_value: PackedStringArray = line.split("=")
		if key_value.size() == 2:
			_env_vars[key_value[0].strip_edges()] = key_value[1].strip_edges()
	file.close()


# Function to get the value of a given key
static func get_key(key: String, required := false) -> String:
	if not _loaded:
		_loaded = true
		_load_env_vars()
	var value: String = _env_vars.get(key, "") if _env_vars else ""
	if value:
		return value
	if required:
		assert(false, "The key '%s' must be defined in the .env file" % key)
	return ""
