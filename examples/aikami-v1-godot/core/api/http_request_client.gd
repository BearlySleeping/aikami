class_name HTTPRequestClient

## If the response can be either Blob or Dictionary,
## you can use Variant as the type of the parsed_response parameter.
signal http_request_completed(parsed_response: Variant, error: Variant)

var _http_request: HTTPRequest


func dispose() -> void:
	if _http_request:
		_http_request.queue_free()
		_http_request = null


func init_http_request() -> HTTPRequest:
	var http_request := HTTPRequest.new()
	SignalManager.add_child_to_scene.emit(http_request)
	return http_request


func get_headers(api_key: String, body: Variant) -> PackedStringArray:
	var headers: PackedStringArray = ["Authorization: Bearer %s" % api_key]
	if body is Dictionary:
		headers.append("Content-Type: application/json")
	return headers


## Use this if you need to modify the headers
func make_raw_request(url: String, headers: PackedStringArray, body: Variant) -> void:
	var error := _get_http_request().request(url, headers, HTTPClient.METHOD_POST, body)
	if error != OK:
		push_error("Something Went Wrong!")


## Use this if you don't need to modify the headers
func make_request(url: String, api_key: String, body: Variant) -> void:
	Logger.debug("make_request", {"url": url, "body": body})
	var headers := get_headers(api_key, body)
	if body is Dictionary:
		body = JSON.stringify(body)
	make_raw_request(url, headers, body)


func _get_http_request() -> HTTPRequest:
	if _http_request:
		return _http_request
	_http_request = init_http_request()
	_http_request.connect("request_completed", _on_http_request_completed)
	return _http_request


func _on_http_request_completed(
	result: int,
	response_code: int,
	headers: PackedStringArray,
	body: PackedByteArray,
) -> void:
	if result != HTTPRequest.RESULT_SUCCESS or response_code != 200:
		return _handle_http_response_error(result, response_code, headers, body)

	# Check if the response is JSON or binary data
	if _is_json_payload(headers):
		return _handle_http_response_json(body)

	# For binary data, just emit the raw body. Handling as blob equivalent in GDScript.
	http_request_completed.emit(body, null)


func _handle_http_response_error(
	result: int,
	response_code: int,
	headers: PackedStringArray,
	body: PackedByteArray,
) -> void:
	printerr(
		(
			"_handle_http_response_error\nresult: %s\nresponse_code: %s\nheaders: %s"
			% [result, response_code, headers]
		)
	)

	# Emit error with more specific information if available
	var error_message := "HTTP request failed with code: %s" % str(response_code)
	if not _is_json_payload(headers):
		return http_request_completed.emit(null, {"error": error_message, "code": response_code})

	var json := JSON.new()
	var error_parsing := json.parse(body.get_string_from_utf8())
	if error_parsing:
		return http_request_completed.emit(null, {"error": error_message, "code": response_code})
	var response: Variant = json.get_data()
	if response is Dictionary and response.has("error"):
		error_message = response.error.message if response.error.has("message") else response.error
	return http_request_completed.emit(
		null, {"error": error_message, "code": response_code, "body": response}
	)


func _handle_http_response_json(body: PackedByteArray) -> void:
	var json := JSON.new()
	var error_parsing := json.parse(body.get_string_from_utf8())
	if error_parsing:
		return http_request_completed.emit(null, {"error": "JSON parsing failed"})

	var response: Variant = json.get_data()
	if !(response is Dictionary):
		return http_request_completed.emit(null, {"error": "Unexpected response format"})

	if response.has("error"):
		return http_request_completed.emit(null, response.error)

	http_request_completed.emit(response, null)


func _is_json_payload(header: Array[String]) -> bool:
	return header.any(func(head: String) -> bool: return head.contains("application/json"))
