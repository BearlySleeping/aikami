class_name HTTPStreamClient

## This file defines the BaseStreamAPI class, which is used for streaming data from a server.
## The class uses the HTTPClient to connect to a server, send requests, and process responses.
## It maintains the state of the connection and the stream, and emits a signal whenever a new chunk of data is received from the stream.
## The class also provides methods for connecting to a host, processing incoming data, handling responses, and closing the connection.

## Emitted when a new chunk of data is received from the stream
signal stream_chunk_added(chunk: PackedByteArray)
signal connection_closed
signal stream_request_completed

var _http_client := HTTPClient.new()

var _is_stream_active := false
var _is_requested := false
var _is_connected := false

var _domain: String
var _path: String
var _port: int
var _headers: PackedStringArray
var _body: String


func _init() -> void:
	SignalManager.processed.connect(_on_processed)


## Connects to the specified host and starts streaming data
func connect_to_host(
	domain: String,
	path: String,
	headers: PackedStringArray,
	body: String,
	port: int,
) -> void:
	Logger.info("BaseStreamAPI.connect_to_host()", [domain, path, headers, port])
	_body = body
	_is_requested = false

	var has_same_connection := (
		_domain == domain and _path == path and _port == port and _headers == headers
	)
	if has_same_connection and _is_connected:
		_is_stream_active = true
		return

	_domain = domain
	_path = path
	_headers = headers
	_port = port
	if _attempt_to_connect():
		_is_stream_active = true


## Use this in AIManager to be called in the _process(delta) function
func _on_processed(_delta: float) -> void:
	if not _is_stream_active:
		return _handle_status_when_not_running()

	var http_status := _get_http_status()
	if not _is_requested:
		return _attempt_to_request(http_status)

	if http_status != HTTPClient.STATUS_BODY or not _http_client.has_response():
		return

	_handle_response()


## Finish a request, but keeps the connection open
func finish_request() -> void:
	_is_stream_active = false
	stream_request_completed.emit()


## Close the connection
func close_connection() -> void:
	if _http_client:
		_http_client.close()
	_is_connected = false
	_is_stream_active = false
	_is_requested = false


## Call this function to handle errors, it will
## emit the http_request_completed signal and close the connection
func handle_stream_error(error: Variant) -> void:
	push_error(error)
	connection_closed.emit()
	close_connection()


func _handle_response() -> void:
	var response_chunk := _http_client.read_response_body_chunk()
	if response_chunk.is_empty():
		return
	stream_chunk_added.emit(response_chunk)


func _get_http_status() -> int:
	_http_client.poll()
	return _http_client.get_status()


func _handle_status_when_not_running() -> void:
	if not _is_connected:
		return
	# When a request is completed it is important to empty the response body
	# in order to change the status back to STATUS_CONNECTED so it is ready for a new request
	var http_status := _get_http_status()
	if http_status == HTTPClient.STATUS_BODY:
		_http_client.read_response_body_chunk()


func _attempt_to_connect() -> bool:
	var connect_error := _http_client.connect_to_host(_domain, _port)
	if connect_error:
		handle_stream_error(connect_error)
		return false

	Logger.info("BaseStreamAPI._attempt_to_connect() OK")
	_is_connected = true
	return true


func _attempt_to_request(http_client_status: int) -> void:
	if http_client_status != HTTPClient.STATUS_CONNECTED:
		return
	_is_requested = true
	var request_error := _http_client.request(HTTPClient.METHOD_POST, _path, _headers, _body)
	if request_error:
		return handle_stream_error(request_error)

	Logger.info("BaseStreamAPI._attempt_to_request() OK")
