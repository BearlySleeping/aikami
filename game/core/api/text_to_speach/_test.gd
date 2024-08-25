extends Node2D

var _stored_streamed_audio: PackedByteArray
var _stream := AudioStreamMP3.new()

@onready var button: Button = $Button
@onready var audio_stream_player: AudioStreamPlayer = $AudioStreamPlayer


# Called when the node enters the scene tree for the first time.
func _ready() -> void:
	button.pressed.connect(_on_pressed)
	SignalManager.voice_chunk_added.connect(_on_voice_chunk_added)
	audio_stream_player.finished.connect(_on_audio_stream_player_finished)


func _on_pressed() -> void:
	var input := BaseTextToSpeachAPI.CallBasicRequestModel.new(
		"Hello!", Enum.VoiceType.MALE_DEFAULT
	)
	var response := await AIManager.text_to_speach(input)
	if response.stream:
		print("Error: ", response.error)
	else:
		print("Error: ", response.error)


func _on_voice_chunk_added(chunk: PackedByteArray) -> void:
	Logger.info("_on_voice_chunk_added:chunk size", chunk.size())
	_stored_streamed_audio.append_array(chunk)
	if audio_stream_player.playing:
		return
	_play_chunk()


func _on_audio_stream_player_finished() -> void:
	Logger.info("_on_audio_stream_player_finished")
	_play_chunk()


func _play_chunk() -> void:
	if _stored_streamed_audio.is_empty():
		return
	_stream.data = _stored_streamed_audio
	audio_stream_player.set_stream(_stream)
	audio_stream_player.play()
	_stored_streamed_audio.clear()
