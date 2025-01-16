extends BaseTextAPI
## TODO: Migrate to this
## https://github.com/oceanbuilders/ChatGPT-stream-for-Godot-4
## https://github.com/teddybear082/godot4-ai-npc-example/
## https://github.com/WolfgangSenff/HTTPSSEClient
## https://github.com/ggerganov/whisper.cpp

## 3.5.turbo = 4,096 tokens
const MAX_TOKENS := 1024
## The temperature can range is from 0 to 2.
## Lower values for temperature result in more consistent outputs (e.g. 0.2),
## while higher values generate more diverse and creative results (e.g. 1.0).
const TEMPERATURE := 0.5
## https://platform.openai.com/docs/models/overview
const MODEL := "gemma2"
const DEFAULT_FUNCTION_CALL = {"name": "", "arguments": ""}

## https://platform.openai.com/docs/api-reference/chat
const DOMAIN := "http://localhost:11434"
const PATH := "/v1/chat/completions"
const URL := DOMAIN + PATH

var _http_request_client := HTTPRequestClient.new()
var _http_stream_client := HTTPStreamClient.new()
var _stream_text := ""
var _function_call := DEFAULT_FUNCTION_CALL.duplicate()
var _completed_stream_text := false


func _init(p_api_key: String) -> void:
	super(p_api_key)
	_http_stream_client.stream_chunk_added.connect(_handle_stream_chunk)


func _reset() -> void:
	_stream_text = ""
	_function_call = DEFAULT_FUNCTION_CALL.duplicate()
	_completed_stream_text = false


func call_text_basic(request: CallBasicRequestModel) -> CallBasicResponseModel:
	_reset()
	var messages := request.messages
	var use_stream := request.use_stream
	var options := _get_options(messages, use_stream)
	var response := CallBasicResponseModel.new()
	var gpt_response := await _make_gpt_request(options, false, use_stream)
	var error: Variant = gpt_response[1]
	if error:
		printerr("call_npc_dialogue_basic:error\n" + str(error))
		response.error = error
		return response

	var parsed_response: Dictionary = gpt_response[0]

	var new_string: String = parsed_response.choices[0].message.content
	Logger.info("call_gpt:response\n", new_string)
	response.text = new_string
	return response


# Modified call_gpt function to include function calling
func call_text_function(
	request: CallFunctionRequestModel,
) -> CallFunctionResponseModel:
	var basic_response := await call_text_basic(CallBasicRequestModel.new(request.messages, false))
	var response := CallFunctionResponseModel.new()
	if basic_response.error:
		response.error = basic_response.error
		return response
	response.data = {"text_response": basic_response.text}
	return response


func _get_options(messages: PackedStringArray, use_stream: bool) -> Dictionary:
	var message_list: Array[Dictionary] = []
	for i in range(messages.size()):
		var role := "user" if i % 2 == 0 else "system"
		message_list.append({"role": role, "content": messages[i]})
	Logger.info("_get_base_options:messages", message_list)
	return {
		"messages": message_list,
		"temperature": TEMPERATURE,
		"max_tokens": MAX_TOKENS,
		"model": MODEL,
		"stream": use_stream,
	}


func _make_gpt_request(options: Dictionary, is_function_call: bool, is_stream: bool) -> Array:
	if is_stream:
		return await _make_gpt_stream_request(options, is_function_call)
	return await _make_gpt_async_request(options)


func _make_gpt_stream_request(options: Dictionary, is_function_call: bool) -> Array:
	(
		_http_stream_client
		. connect_to_host(
			DOMAIN,
			PATH,
			(
				_http_request_client
				. get_headers(
					api_key,
					options,
				)
			),
			JSON.stringify(options),
			443,
		)
	)
	SignalManager.text_chunk_added.emit("")
	await _http_stream_client.stream_request_completed
	var message := (
		{"tool_calls": [{"function": _function_call}]}
		if is_function_call
		else {"content": _stream_text}
	)
	var response := {"choices": [{"message": message}]}
	return [response, null]


func _make_gpt_async_request(options: Dictionary) -> Array:
	(
		_http_request_client
		. make_request(
			URL,
			api_key,
			options,
		)
	)
	return await _http_request_client.http_request_completed


func _to_gpt_function_request(function_call_model: CallFunctionRequestModel) -> Dictionary:
	var name := function_call_model.name
	var description := function_call_model.description
	var fields := function_call_model.fields

	var properties: Dictionary = {}
	for field in fields:
		var field_properties: Dictionary = {
			"type": field.type,
			"description": field.description,
		}
		if field.enum_fields and field.enum_fields.size():
			field_properties["enum"] = field.enum_fields  # Add enum to properties if it's not null and not empty
		properties[field.name] = field_properties

	var required_fields: Array = fields.filter(func(x: FieldModel) -> bool: return x.required).map(
		func(x: FieldModel) -> String: return x.name
	)
	return {
		"type": "function",
		"function":
		{
			"name": name,
			"description": description,
			"parameters":
			{
				"type": "object",
				"properties": properties,
				"required": required_fields,
			},
		},
	}


# Since each chunk sometimes can contain more than one delta of data this
# function will iterate through each "data" block found and extract its
# content concatenating it in an array.
func _handle_stream_chunk(chunk: PackedByteArray) -> void:
	var response := chunk.get_string_from_utf8()
	if !response:
		return
	Logger.debug("_handle_chunks:chunk", response)
	response = response.strip_edges()  # Remove leading and trailing whitespaces, including new lines
	var data_entries := response.split("\n\n")  # Split the body into individual data entries
	for entry in data_entries:
		if !_handle_chunk_entry(entry.replace("data: ", "")):
			return


func _handle_chunk_entry(entry: String) -> bool:
	Logger.debug("_handle_chunk_entry:entry", entry)
	if entry == "[DONE]":
		Logger.debug("_handle_chunk_entry:stream_result", _stream_text)
		_http_stream_client.finish_request()
		SignalManager.text_chunk_added.emit("")
		return false

	var parsed_data: Variant = JSON.parse_string(entry)
	if parsed_data == null:
		_http_stream_client.handle_stream_error("Error: Failed to parse the received data")
		return false
	var has_choices: bool = "choices" in parsed_data and parsed_data["choices"].size()
	if not has_choices:
		_http_stream_client.handle_stream_error(
			"Error: 'choices' field not found in the received data"
		)
		return false

	var choices: Dictionary = parsed_data["choices"][0]
	if not ("delta" in choices):
		_http_stream_client.handle_stream_error("Error: 'delta' field not found in the 'choices'")
		return true

	var delta: Dictionary = choices["delta"]
	if delta.is_empty():
		return true

	if "tool_calls" in delta:
		var function: Variant = delta["tool_calls"][0].function
		if "name" in function:
			_function_call["name"] = function["name"]
		if "arguments" in function and function["arguments"]:
			var arguments: String = function["arguments"]
			_function_call["arguments"] += arguments
			if _completed_stream_text:
				return true
			var total_arguments: String = _function_call["arguments"]
			const RESPONSE_FINDER := 'text_response":"'
			var text_response_start_index := total_arguments.find(RESPONSE_FINDER)
			if text_response_start_index != -1:
				text_response_start_index += RESPONSE_FINDER.length()  # Move the start index to the start of the value
				var text_response_end_index := total_arguments.find('"', text_response_start_index)
				if text_response_end_index == -1:
					text_response_end_index = total_arguments.length()
				else:
					_completed_stream_text = true
				var text_response: String = total_arguments.substr(
					text_response_start_index, text_response_end_index
				)
				text_response = clean_text_response(text_response)
				# Remove the part of text_response that is already in _stream_text
				text_response = text_response.replace(_stream_text, "")
				if text_response:
					_stream_text += text_response
					SignalManager.text_chunk_added.emit(text_response)

	elif "content" in delta:
		if delta.content:
			var chunk_text: String = delta["content"]
			_stream_text += chunk_text
			SignalManager.text_chunk_added.emit(chunk_text)
	else:
		_http_stream_client.handle_stream_error("Error: 'content' field not found in the 'delta'")
		return false

	return true


func clean_text_response(text_response: String) -> String:
	const UNWANTED_CHARS: PackedStringArray = ['"', "{", "}"]

	# Trim leading and trailing spaces
	text_response = text_response.strip_edges()

	# Remove all instances of unwanted characters
	for unwanted_char in UNWANTED_CHARS:
		text_response = text_response.replace(unwanted_char, "")

	text_response = text_response.replace(".,", ".")

	return text_response
