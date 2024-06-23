extends BaseTextToSpeachAPI

# https://api.elevenlabs.io/v1/models
const MODELS := [
	"eleven_multilingual_v2",
	"eleven_multilingual_v1",
	"eleven_monolingual_v1",
	"eleven_english_sts_v2",
	"eleven_turbo_v2",
	"eleven_multilingual_sts_v2"
]

const DOMAIN := "https://api.elevenlabs.io"
const PATH := "/v1/text-to-speech"

# https://api.elevenlabs.io/v1/voices
const VOICES := {
	"Rachel": "21m00Tcm4TlvDq8ikWAM",
	"Drew": "29vD33N1CtxCmqQRPOHJ",
	"Clyde": "2EiwWnXFnvU5JabPnv8n",
	"Paul": "5Q0t7uMcjvnagumLfvZi",
	"Domi": "AZnzlk1XvdvUeBnXmlld",
	"Dave": "CYw3kZ02Hs0563khs1Fj",
	"Fin": "D38z5RcWu1voky8WS1ja",
	"Sarah": "EXAVITQu4vr4xnSDxMaL",
	"Antoni": "ErXwobaYiN019PkySvjV",
	"Thomas": "GBv7mTt0atIp3Br8iCZE",
	"Charlie": "IKne3meq5aSn9XLyUdCD",
	"George": "JBFqnCBsd6RMkjVDRZzb",
	"Emily": "LcfcDJNUP1GQjkzn1xUU",
	"Elli": "MF3mGyEYCl7XYWbV9V6O",
	"Callum": "N2lVS1w4EtoT3dr4eOWO",
	"Patrick": "ODq5zmih8GrVes37Dizd",
	"Harry": "SOYHLrjzK2X1ezoPC6cr",
	"Liam": "TX3LPaxmHKxFdv7VOQHJ",
	"Dorothy": "ThT5KcBeYPX3keUQqHPh",
	"Josh": "TxGEqnHWrfWFTfGW9XjX",
	"Arnold": "VR6AewLTigWG4xSOukaG",
	"Charlotte": "XB0fDUnXU5powFXDhCwa",
	"Alice": "Xb7hH8MSUJpSbSDYk0k2",
	"Matilda": "XrExE9yKIg1WjnnlVkGX",
	"Matthew": "Yko7PKHZNXotIFUBG7I9",
	"James": "ZQe5CZNOzWyzPSCn5a3c",
	"Joseph": "Zlb1dXrM653N07WRdFW3",
	"Jeremy": "bVMeCyTHy58xNoL34h3p",
	"Michael": "flq6f7yk4E4fJM5XTYuZ",
	"Ethan": "g5CIjZEefAph4nQFvHAz",
	"Chris": "iP95p4xoKVk53GoZ742B",
	"Gigi": "jBpfuIE2acCO8z3wKNLl",
	"Freya": "jsCqWAovK2LkecY7zXl4",
	"Brian": "nPczCjzI2devNBz1zQrb",
	"Grace": "oWAxZDx7w5VEj9dCyTzz",
	"Daniel": "onwK4e9ZLuTAKqWW03F9",
	"Lily": "pFZP5JQG7iQjIQuC4Bku",
	"Serena": "pMsXgVXv3BLzUgSXRplE",
	"Adam": "pNInz6obpgDQGcFmaJgB",
	"Nicole": "piTKgcLEGmPE4e6mEKli",
	"Bill": "pqHfZKP75CvOlQylNhV4",
	"Jessie": "t0jbNlBVZ17f02VDIeMI",
	"Sam": "yoZ06aMxZJJ28mfd3POQ",
	"Glinda": "z9fAnlkpzviPz146aGWa",
	"Giovanni": "zcAOhNBS3c14rBihAFp1",
	"Mimi": "zrHiDhphv9ZnVXBqCLjz"
}

## Character code used for voice to use
var voice_id := "21m00Tcm4TlvDq8ikWAM"

# Whether to use audio stream endpoint
var use_stream_mode := true

var _http_request_client := HTTPRequestClient.new()
var _http_stream_client := HTTPStreamClient.new()
var _web_socket_client := WebSocketClient.new()
var _socket_is_connected := false
var _text_buffer: PackedStringArray = []


func _init(p_api_key: String) -> void:
	super(p_api_key)
	_web_socket_client.socket_message_added.connect(_handle_socket_message)
	_http_stream_client.stream_chunk_added.connect(_handle_stream_chunk)


func _setup_socket() -> void:
	(
		_web_socket_client
		. connect_to_socket_url(
			(
				"wss://api.elevenlabs.io/v1/text-to-speech/%s/stream-input?model_id=eleven_monolingual_v1"
				% voice_id
			)
		)
	)
	await _web_socket_client.connected_to_server
	(
		_web_socket_client
		. send(
			(
				JSON
				. stringify(
					{
						"text": " ",
						"voice_settings": _get_voice_settings(),
						"xi_api_key": api_key,
					}
				)
			)
		)
	)
	_socket_is_connected = true


func handle_text_chunk_added(text: String) -> void:
	Logger.debug("ElevenLabsVoiceAPI:_handle_text_chunk_added", text)

	if not text and not _socket_is_connected:
		await _setup_socket()
		return

	_text_buffer.append(text)
	if not _socket_is_connected:
		return

	for buffered_text in _text_buffer:
		(
			_web_socket_client
			. send(
				(
					JSON
					. stringify(
						{
							"text": buffered_text,
							"try_trigger_generation": !!buffered_text,
						}
					)
				)
			)
		)

	if not text:
		_socket_is_connected = false

	_text_buffer.clear()


func _get_voice_settings() -> Dictionary:
	return {
		"stability": 0.5,
		"similarity_boost": 0.8,
		"style": 0,
		"use_speaker_boost": true,
	}


func _get_headers() -> PackedStringArray:
	return PackedStringArray(
		[
			"xi-api-key: " + api_key,
			"Content-Type: application/json",
		]
	)


func _get_path(use_stream: bool) -> String:
	var path := PATH + "/" + voice_id
	if use_stream:
		path += "/stream"
	var optimize_streaming_latency := 0

	if optimize_streaming_latency:
		# You can turn on latency optimizations at some cost of quality.
		# The best possible final latency varies by model. Possible values: 0 - default mode (no latency optimizations)
		# 1 - normal latency optimizations (about 50% of possible latency improvement of option 3)
		# 2 - strong latency optimizations (about 75% of possible latency improvement of option 3)
		# 3 - max latency optimizations 4 - max latency optimizations, but also with text normalizer turned off for even more latency savings
		#  (best latency, but can mispronounce eg numbers and dates).
		# @default 0
		path += "?optimize_streaming_latency=" + str(optimize_streaming_latency)
	return path


func _make_stream_request(path: String, headers: PackedStringArray, options: Variant) -> void:
	(
		_http_stream_client
		. connect_to_host(
			DOMAIN,
			path,
			headers,
			JSON.stringify(options),
			443,
		)
	)
	await _http_stream_client.stream_request_completed


func _make_request(path: String, headers: PackedStringArray, options: Variant) -> Array:
	var url := DOMAIN + path

	(
		_http_request_client
		. make_raw_request(
			url,
			headers,
			options,
		)
	)

	return await _http_request_client.http_request_completed


func _get_options(text: String) -> Dictionary:
	var options := {
		# Identifier of the model that will be used, you can query them using GET /v1/models.
		# The model needs to have support for text to speech, you can check this using the can_do_text_to_speech property.
		"model_id": "eleven_monolingual_v1",
		# The text that will get converted into speech.
		"text": text,
		# Voice settings overriding stored setttings for the given voice. They are applied only on the given request.
		"voice_settings": _get_voice_settings(),
	}
	return options


# Call Eleven labs API for text to speech
func text_to_speach(request: CallBasicRequestModel) -> CallBasicResponseModel:
	var options := _get_options(request.text)
	var headers := _get_headers()
	var path := _get_path(use_stream_mode)
	var response := CallBasicResponseModel.new()

	if use_stream_mode:
		await _make_stream_request(path, headers, options)
		return response

	var eleven_labs_response := await _make_request(path, headers, options)
	var error: Variant = eleven_labs_response[1]
	if error:
		push_error("Error in Eleven Labs request: ", error)
		response.error = error
		return response
	#var stored_streamed_audio: PackedByteArray = eleven_labs_response[0]

	# _stream.data = stored_streamed_audio
	# response.stream = _stream
	return response


# Since each chunk sometimes can contain more than one delta of data this
# function will iterate through each "data" block found and extract its
# content concatenating it in an array.
func _handle_stream_chunk(chunk: PackedByteArray) -> void:
	SignalManager.voice_chunk_added.emit(chunk)


func _handle_socket_message(chunk: Variant) -> void:
	if not chunk or not (chunk is String):
		return

	var parsed: Dictionary = JSON.parse_string(chunk)
	if not "audio" in parsed or not parsed.audio:
		return

	var data := Marshalls.base64_to_raw(parsed["audio"])
	SignalManager.voice_chunk_added.emit(data)
