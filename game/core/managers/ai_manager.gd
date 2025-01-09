class_name AIManager

enum ProviderType { IMAGE, TEXT, TEXT_TO_SPEACH, SPEACH_TO_TEXT }
enum ImageProvider { DALLE, HUGGING_FACE }
enum TextProvider { OPEN_AI, OLLAMA }
enum TextToSpeachProvider { ELEVEN_LABS }
enum SpeachToTextProvider { HUGGING_FACE }

const PROVIDERS_MAP := {
	ProviderType.IMAGE:
	{
		ImageProvider.DALLE:
		["res://core/api/image/dalle_image.gd", ConfigManager.ConfigKey.API_OPEN_AI_KEY],
		ImageProvider.HUGGING_FACE:
		["res://core/api/image/hf_image.gd", ConfigManager.ConfigKey.API_HUGGING_FACE_KEY]
	},
	ProviderType.TEXT:
	{
		TextProvider.OPEN_AI:
		["res://core/api/text/open_ai.gd", ConfigManager.ConfigKey.API_OPEN_AI_KEY],
		TextProvider.OLLAMA: ["res://core/api/text/ollama.gd", "ollama"],
	},
	ProviderType.TEXT_TO_SPEACH:
	{
		TextToSpeachProvider.ELEVEN_LABS:
		[
			"res://core/api/text_to_speach/eleven_labs.gd",
			ConfigManager.ConfigKey.API_ELEVEN_LABS_KEY
		],
	},
	ProviderType.SPEACH_TO_TEXT:
	{
		SpeachToTextProvider.HUGGING_FACE:
		["res://core/api/speach_to_text/hf_stt.gd", ConfigManager.ConfigKey.API_HUGGING_FACE_KEY]
	}
}

static var _providers: Dictionary = {}


static func _get_provider(provider_type: ProviderType) -> Object:
	if _providers.has(provider_type):
		return _providers[provider_type]
	var provider_config := _get_provider_config(provider_type)
	_providers[provider_type] = _instantiate_provider(provider_config)
	return _providers[provider_type]


static func _get_provider_config(provider_type: ProviderType) -> Array:
	const CONFIG_MAP = {
		ProviderType.IMAGE: ConfigManager.ConfigKey.API_IMAGE_PROVIDER,
		ProviderType.TEXT: ConfigManager.ConfigKey.API_TEXT_PROVIDER,
		ProviderType.TEXT_TO_SPEACH: ConfigManager.ConfigKey.API_TEXT_TO_SPEACH_PROVIDER,
		ProviderType.SPEACH_TO_TEXT: ConfigManager.ConfigKey.API_SPEACH_TO_TEXT_PROVIDER,
	}

	var config_key: ConfigManager.ConfigKey = CONFIG_MAP[provider_type]
	var default_provider: int = PROVIDERS_MAP[provider_type].keys()[0]
	var provider: int = ConfigManager.get_value(config_key, default_provider)
	return PROVIDERS_MAP[provider_type][provider]


static func _instantiate_provider(provider_config: Array) -> BaseAPI:
	var provider_path: String = provider_config[0]
	var provider_api_key: String
	if provider_config[1] is String:
		provider_api_key = provider_config[1]
	else:
		var provider_config_key: ConfigManager.ConfigKey = provider_config[1]
		provider_api_key = ConfigManager.get_value(provider_config_key)
	var resource := load(provider_path)
	return resource.new(provider_api_key)


static func dispose_providers() -> void:
	for provider: BaseAPI in _providers.values():
		provider.dispose()
	_providers.clear()


static func set_current_npc(npc: NPCModel) -> void:
	var voice_type := npc.voice_type
	_get_provider(ProviderType.TEXT_TO_SPEACH).set_current_voice_type(voice_type)


## Call this when you want voice to an incoming stream text
## have the chunk be empty to initialize the connection to the tts provider
## And have the chunk be empty text to close the connection
static func generate_voice_with_text_chunk(chunk: String) -> void:
	_get_provider(ProviderType.TEXT_TO_SPEACH).handle_text_chunk_added(chunk)


static func speach_to_text(
	input: BaseSpeachToTextAPI.CallBasicRequestModel
) -> BaseSpeachToTextAPI.CallBasicResponseModel:
	return await _get_provider(ProviderType.SPEACH_TO_TEXT).speach_to_text(input)


static func text_to_speach(
	input: BaseTextToSpeachAPI.CallBasicRequestModel
) -> BaseTextToSpeachAPI.CallBasicResponseModel:
	return await _get_provider(ProviderType.TEXT_TO_SPEACH).text_to_speach(input)


## Will generate an image and store it in a given path
static func generate_image(input: BaseImageAPI.ImageInputModel) -> BaseImageAPI.ImageOutputModel:
	return await _get_provider(ProviderType.IMAGE).generate_image(input)


## Used to call advanced text response that will return a dictionary
## If you just want text response use call_text_basic
static func call_text_function(
	request: BaseTextAPI.CallFunctionRequestModel
) -> BaseTextAPI.CallFunctionResponseModel:
	return await _get_provider(ProviderType.TEXT).call_text_function(request)


## Used to call basic text response
## If you want advanced response use call_text_function
static func call_text_basic(
	request: BaseTextAPI.CallBasicRequestModel
) -> BaseTextAPI.CallBasicResponseModel:
	return await _get_provider(ProviderType.TEXT).call_text_basic(request)
