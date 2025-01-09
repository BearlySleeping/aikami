extends Node2D

var effect: AudioEffect
var _stream := AudioStreamWAV.new()
var _data: PackedByteArray
var _is_recording := false

@onready var rich_text_label: RichTextLabel = $RichTextLabel
@onready var button: Button = $Button
@onready var audio_stream_player: AudioStreamPlayer = $AudioStreamPlayer
@onready var button_2: Button = $Button2
@onready var button_3: Button = $Button3


# Called when the node enters the scene tree for the first time.
func _ready() -> void:
	var idx := AudioServer.get_bus_index("Record")
	effect = AudioServer.get_bus_effect(idx, 0)
	button.pressed.connect(_toggle_recording)
	button_2.pressed.connect(_preview)
	button_3.pressed.connect(_start)
	SignalManager.speach_to_text_chunk_added.connect(_on_text_chunk_added)


func _toggle_recording() -> void:
	if not _is_recording:
		_is_recording = true
		effect.set_recording_active(true)
		return
	_is_recording = false
# TODO: wait til https://github.com/godotengine/godot/issues/81950 is fixed
	var recording: AudioStreamWAV = await effect.get_recording()
	effect.set_recording_active(false)
	_data = recording.get_data()


func _on_text_chunk_added(text: String) -> void:
	rich_text_label.text += text


func _preview() -> void:
	Logger.info("Data size: " + str(_data.size()))
	_stream.data = _data
	audio_stream_player.stream = _stream
	audio_stream_player.play()


func _start() -> void:
	var file := FileAccess.open("res://assets/voice-female.wav", FileAccess.READ)
	_data = file.get_buffer(file.get_length())
	var input := BaseSpeechToTextAPI.CallBasicRequestModel.new(_data, true)
	rich_text_label.text = ""
	AIManager.speech_to_text(input)
