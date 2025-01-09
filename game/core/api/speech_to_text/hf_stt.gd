extends BaseSpeechToTextAPI

const MODEL := "gpt-3.5-turbo"
## https://platform.openai.com/docs/api-reference/chat
const DOMAIN := "https://api-inference.huggingface.co"
const PATH := "/models/openai/whisper-large-v3"

var _http_stream_client := HTTPStreamClient.new()
var _stream_text := ""


func _init(p_api_key: String) -> void:
	super(p_api_key)
	_http_stream_client.stream_chunk_added.connect(_handle_stream_chunk)


func _reset() -> void:
	_stream_text = ""


func speach_to_text(request: CallBasicRequestModel) -> CallBasicResponseModel:
	_reset()
	var use_stream := request.use_stream
	var options := _get_options(request.data, use_stream)
	var response := CallBasicResponseModel.new()
	var gpt_response := await _make_stream_request(options)
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


func _get_options(data: PackedByteArray, use_stream: bool) -> Dictionary:
	return {
		"inputs": Marshalls.raw_to_base64(data),
		"stream": use_stream,
	}


func _make_stream_request(options: Dictionary) -> Array:
	(
		_http_stream_client
		. connect_to_host(
			DOMAIN,
			PATH,
			get_headers(options),
			JSON.stringify(options),
			443,
		)
	)
	SignalManager.speach_to_text_chunk_added.emit("")
	await _http_stream_client.stream_request_completed
	return [_stream_text, null]


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
		if !handle_chunk_entry(entry.replace("data: ", "")):
			return


func handle_chunk_entry(entry: String) -> bool:
	Logger.debug("handle_chunk_entry:entry", entry)
	if entry == "[DONE]":
		Logger.debug("handle_chunk_entry:stream_result", _stream_text)
		_http_stream_client.finish_request()
		SignalManager.speach_to_text_chunk_added.emit("")
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

	if "content" in delta:
		if delta.content:
			var chunk_text: String = delta["content"]
			_stream_text += chunk_text
			SignalManager.speach_to_text_chunk_added.emit(chunk_text)
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
