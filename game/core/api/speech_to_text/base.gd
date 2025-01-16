class_name BaseSpeechToTextAPI
extends BaseAPI


# Custom model for a GPT function call
class CallBasicRequestModel:
	var data: PackedByteArray
	var use_stream: bool = false

	func _init(p_data: PackedByteArray, p_use_stream: bool) -> void:
		data = p_data
		use_stream = p_use_stream


class CallBasicResponseModel:
	var error: Variant
	var text: String


func speech_to_text(_request: CallBasicRequestModel) -> CallBasicResponseModel:
	assert(false, "Not implemented")
	var response: CallBasicResponseModel = await SignalManager.processed
	return response
