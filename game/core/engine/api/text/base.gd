class_name BaseTextAPI
extends BaseAPI


# Base model for a function call parameter
class FieldModel:
	## The key of the field, has to be unique of the fields provided
	var name: String
	## Description to help the AI know what the porpuse of the field is.
	var description: String
	## Valid options: string, number, array
	var type: String
	## If true then the AI must include this field
	## @default true
	var required: bool
	## List of predefined choices
	## @Optional
	var enum_fields: PackedStringArray

	func _init(
		p_name: String,
		p_type: String,
		p_description: String,
		p_required: bool = true,
		p_enum_fields: PackedStringArray = []
	) -> void:
		name = p_name
		type = p_type
		description = p_description
		required = p_required
		enum_fields = p_enum_fields


class CallFunctionRequestModel:
	## Function name - use a meaningful name related to its functionality
	var name: String
	var description: String
	var fields: Array[FieldModel]
	var messages: PackedStringArray
	var use_stream: bool

	func _init(
		p_name: String,
		p_description: String,
		p_messages: PackedStringArray,
		p_fields: Array[FieldModel],
		p_use_stream: bool = false
	) -> void:
		name = p_name
		description = p_description
		messages = p_messages
		fields = p_fields
		use_stream = p_use_stream


class CallFunctionResponseModel:
	var error: Variant
	var data: Dictionary


# Custom model for a GPT function call
class CallBasicRequestModel:
	var messages: PackedStringArray
	var use_stream: bool

	func _init(p_messages: PackedStringArray, p_use_stream: bool) -> void:
		messages = p_messages
		use_stream = p_use_stream


class CallBasicResponseModel:
	var error: Variant
	var text: String


## Used to call basic text response
## If you want advanced response use call_text_function
func call_text_basic(_request: CallBasicRequestModel) -> CallBasicResponseModel:
	assert(false, "Not implemented")
	var response: CallBasicResponseModel = await SignalManager.processed
	return response


## Used to call advanced text response that will return a dictionary
## If you just want text response use call_text_basic
func call_text_function(_request: CallFunctionRequestModel) -> CallFunctionResponseModel:
	assert(false, "Not implemented")
	var response: CallFunctionResponseModel = await SignalManager.processed
	return response
