extends TabBar

@onready var open_ai_key_input: LineEdit = %OpenAIKeyInput
@onready var eleven_labs_key_input: LineEdit = %ElevenLabsKeyInput
@onready var eleven_labs_field: HBoxContainer = %ElevenLabsField
@onready var tts_enabled_button: CheckButton = %TTSEnabledButton


func _ready() -> void:
	var text_to_speach_enabled: bool = ConfigManager.get_value(
		ConfigManager.ConfigKey.API_TEXT_TO_SPEACH_ENABLED, true
	)
	if text_to_speach_enabled:
		tts_enabled_button.button_pressed = true
		eleven_labs_field.show()
	else:
		eleven_labs_field.hide()
	var eleven_labs_api_key: String = ConfigManager.get_value(
		ConfigManager.ConfigKey.API_ELEVEN_LABS_KEY, Env.get_key("API_ELEVEN_LABS_KEY")
	)
	if eleven_labs_api_key:
		eleven_labs_key_input.text = eleven_labs_api_key
		_set_value(ConfigManager.ConfigKey.API_ELEVEN_LABS_KEY, eleven_labs_api_key)

	var open_ai_api_key: String = ConfigManager.get_value(
		ConfigManager.ConfigKey.API_OPEN_AI_KEY, Env.get_key("API_OPEN_AI_KEY")
	)
	if open_ai_api_key:
		open_ai_key_input.text = open_ai_api_key
		_set_value(ConfigManager.ConfigKey.API_OPEN_AI_KEY, open_ai_api_key)


func _on_eleven_labs_key_input_text_changed(new_text: String) -> void:
	_set_value(ConfigManager.ConfigKey.API_ELEVEN_LABS_KEY, new_text)


func _on_open_ai_key_input_text_changed(new_text: String) -> void:
	_set_value(ConfigManager.ConfigKey.API_OPEN_AI_KEY, new_text)


func _on_check_button_toggled(toggled_on: bool) -> void:
	ConfigManager.set_value(ConfigManager.ConfigKey.API_TEXT_TO_SPEACH_ENABLED, toggled_on)
	if toggled_on:
		eleven_labs_field.show()
	else:
		eleven_labs_field.hide()

func _set_value(key: ConfigManager.ConfigKey, value: String) -> void:
	ConfigManager.set_value(key, value.strip_edges())
