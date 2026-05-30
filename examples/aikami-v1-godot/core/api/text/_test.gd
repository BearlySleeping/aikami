extends Node2D

var _stored_streamed_audio: PackedByteArray
var _stream := AudioStreamMP3.new()

@onready var button: Button = $Button
@onready var rich_text_label: RichTextLabel = $RichTextLabel
@onready var audio_stream_player: AudioStreamPlayer = $AudioStreamPlayer


# Called when the node enters the scene tree for the first time.
func _ready() -> void:
	button.pressed.connect(_on_pressed)
	SignalManager.text_chunk_added.connect(_on_text_chunk_added)
	SignalManager.voice_chunk_added.connect(_on_voice_chunk_added)
	audio_stream_player.finished.connect(_on_audio_stream_player_finished)


func _on_text_chunk_added(text: String) -> void:
	rich_text_label.text += text


func _on_pressed() -> void:
	var input := BaseTextAPI.CallBasicRequestModel.new(["Test"], true)
	rich_text_label.text = ""
	var response := await AIManager.call_text_basic(input)
	Logger.info("response", response)


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
