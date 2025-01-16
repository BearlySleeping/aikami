extends Node
# Singleton name: SignalManager

## When a text stream chunk is updated, it does not include the old chunks
signal text_chunk_added(text: String)

## When a text stream chunk is updated with stt, it does not include the old chunks
signal speech_to_text_chunk_added(text: String)

## When a voice stream chunk is added, it does not include the old chunks
signal voice_chunk_added(audio_bytes: PackedByteArray)

signal processed(delta: float)

signal add_child_to_scene(child: Node)


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	add_child_to_scene.connect(add_child)


func _process(delta: float) -> void:
	processed.emit(delta)
