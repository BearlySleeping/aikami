class_name BaseTextToSpeachAPI
extends BaseAPI


# Custom model for a GPT function call
class CallBasicRequestModel:
	var text: String
	var voice_type: Enum.VoiceType

	func _init(p_text: String, p_voice_type: Enum.VoiceType) -> void:
		voice_type = p_voice_type
		text = p_text


class CallBasicResponseModel:
	var error: Variant
	var stream: AudioStream


func text_to_speach(_request: CallBasicRequestModel) -> CallBasicResponseModel:
	assert(false, "Not implemented")
	var response: CallBasicResponseModel = await SignalManager.processed
	return response


func handle_text_chunk_added(_text: String) -> void:
	assert(false, "Not implemented")
