class_name WebSocketClient

## Emitted when a new message is received
signal socket_message_added(message: Variant)
signal connected_to_server
signal connection_closed

var _socket := WebSocketPeer.new()

var _is_socket_connected := false
var _last_state := WebSocketPeer.STATE_CLOSED
var _url: String


func _init() -> void:
	SignalManager.processed.connect(_on_processed)


func _on_processed(_delta: float) -> void:
	if not _is_socket_connected:
		return
	_poll()


## Connects to the specified URL
func connect_to_socket_url(url: String) -> void:
	Logger.info("Connecting to", [url, _is_socket_connected])
	if _is_socket_connected and _url == url:
		connected_to_server.emit()
		return

	_url = url
	_is_socket_connected = false

	var connect_error := _socket.connect_to_url(_url)
	if connect_error:
		return handle_websocket_error(connect_error)

	_is_socket_connected = true


func send(message: Variant) -> int:
	Logger.debug("Sending message", message)
	if typeof(message) == TYPE_STRING:
		return _socket.send_text(message)
	return _socket.send(var_to_bytes(message))


func get_message() -> Variant:
	if not _socket.get_available_packet_count():
		return null
	var pkt := _socket.get_packet()
	if _socket.was_string_packet():
		return pkt.get_string_from_utf8()
	return bytes_to_var(pkt)


func close_connection(code := 1000, reason := "") -> void:
	_socket.close(code, reason)
	_last_state = _socket.get_ready_state()


func handle_websocket_error(error: Variant) -> void:
	push_error(error)
	close_connection()


func clear() -> void:
	_socket = WebSocketPeer.new()
	_last_state = _socket.get_ready_state()


func _poll() -> void:
	if _socket.get_ready_state() != _socket.STATE_CLOSED:
		_socket.poll()
	var state := _socket.get_ready_state()
	if _last_state != state:
		_on_state_changed(state)

	while _socket.get_ready_state() == _socket.STATE_OPEN and _socket.get_available_packet_count():
		socket_message_added.emit(get_message())


func _on_state_changed(state: WebSocketPeer.State) -> void:
	Logger.info("WebSocket state changed to", state)
	_last_state = state
	if state == _socket.STATE_OPEN:
		Logger.info("WebSocket connection established")
		connected_to_server.emit()
	elif state == _socket.STATE_CLOSED:
		Logger.info("WebSocket connection closed")
		connection_closed.emit()
		_is_socket_connected = false
