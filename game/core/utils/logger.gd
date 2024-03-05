class_name Logger

# LogLevel enum matching TypeScript's LogLevelPriority for simplicity
enum LogLevel {
	NONE,
	DEBUG,
	INFO,
	WARNING,
	ERROR,
	CRITICAL,
}

const LOG_FORMAT = "[{level}] {message}"

# Default log level
static var current_log_level := LogLevel.INFO


# Method to set the log level
static func set_log_level(level: LogLevel) -> void:
	current_log_level = level


# Utility method to determine if a log should be processed based on its level
static func _should_log(level: LogLevel) -> bool:
	return level >= current_log_level


# Log message method
static func _log(level: LogLevel, message: String, data: Variant) -> void:
	if not _should_log(level):
		return
	var log_level_name: String = LogLevel.keys()[level]
	var text := "[%s] %s" % [log_level_name.to_upper(), message]
	if data:
		text += "\n" + str(data)
	match level:
		LogLevel.WARNING:
			return push_warning(text)
		LogLevel.ERROR, LogLevel.CRITICAL:
			return push_error(text)
		_:
			return print_rich(text)


static func debug(message: String, data: Variant = null) -> void:
	_log(LogLevel.DEBUG, message, data)


static func info(message: String, data: Variant = null) -> void:
	_log(LogLevel.INFO, message, data)


## Use push_warning instead
static func warn(message: String, data: Variant = null) -> void:
	_log(LogLevel.WARNING, message, data)


## Use push_error instead
static func error(message: String, data: Variant = null) -> void:
	_log(LogLevel.ERROR, message, data)


## Use push_error instead
static func critical(message: String, data: Variant = null) -> void:
	_log(LogLevel.CRITICAL, message, data)
