extends PlayerState

var attacking: bool = false

@export var attack_sound: AudioStream
@export_range(1, 20, 0.5) var decelerate_speed: float = 5.0

@onready var animation_player: AnimationPlayer = $"../../AnimationPlayer"
@onready var attack_anim: AnimationPlayer = $"../../Sprite2D/AttackEffectSprite/AnimationPlayer"
@onready var audio: AudioStreamPlayer2D = $"../../Audio/AudioStreamPlayer2D"

@onready var idle: PlayerState = $"../Idle"
@onready var walk: PlayerState = $"../Walk"
@onready var hurt_box: HurtBox = %AttackHurtBox


## What happens when the player enters this PlayerState?
func enter() -> void:
	player.update_animation("attack")
	attack_anim.play("attack_" + player.anim_direction())
	animation_player.animation_finished.connect(_end_attack)

	audio.stream = attack_sound
	audio.pitch_scale = randf_range(0.9, 1.1)
	audio.play()

	attacking = true

	await get_tree().create_timer(0.075).timeout
	if attacking:
		hurt_box.monitoring = true


## What happens when the player exits this PlayerState?
func exit() -> void:
	animation_player.animation_finished.disconnect(_end_attack)
	attacking = false
	hurt_box.monitoring = false


## What happens during the _process update in this PlayerState?
func process(_delta: float) -> PlayerState:
	player.velocity -= player.velocity * decelerate_speed * _delta

	if attacking == false:
		if player.direction == Vector2.ZERO:
			return idle
		else:
			return walk
	return null


## What happens during the _physics_process update in this PlayerState?
func physics(_delta: float) -> PlayerState:
	return null


## What happens with input events in this PlayerState?
func handle_input(_event: InputEvent) -> PlayerState:
	return null


func _end_attack(_newAnimName: String) -> void:
	attacking = false
