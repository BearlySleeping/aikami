class_name LoadingScreen
extends CanvasLayer

signal transition_in_complete

var starting_animation_name: String
@onready var progress_bar: ProgressBar = %ProgressBar
@onready var anim_player: AnimationPlayer = %AnimationPlayer
@onready var timer: Timer = $Timer


func _ready() -> void:
	progress_bar.visible = false


func start_transition(animation_name: String) -> void:
	if !anim_player.has_animation(animation_name):
		push_warning("'%s' animation does not exist" % animation_name)
		animation_name = "fade_to_black"
	starting_animation_name = animation_name
	anim_player.play(animation_name)

	# if timer reaches the end before we finish loading, this will show the progress bar
	timer.start()


# called by SceneManger to play the outro to the transition once the content is loaded
func finish_transition() -> void:
	if timer:
		timer.stop()
	# construct second half of the transitation's animation name
	var ending_animation_name: String = starting_animation_name.replace("to", "from")

	if !anim_player.has_animation(ending_animation_name):
		push_warning("'%s' animation does not exist" % ending_animation_name)
		ending_animation_name = "fade_from_black"
	anim_player.play(ending_animation_name)

	# once this final animation plays, we can free this scene
	await anim_player.animation_finished
	queue_free()


func report_midpoint() -> void:
	transition_in_complete.emit()


func _on_timer_timeout() -> void:
	progress_bar.visible = true


func update_bar(val: float) -> void:
	progress_bar.value = val
