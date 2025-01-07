class_name Player extends CharacterBody2D

signal request_path_to_target(
	current_position: Vector2i, target_position: Vector2i, path: PackedVector2Array
)
signal direction_changed(new_direction: Vector2)
signal player_damaged(hurt_box: HurtBox)

const DIR_4 = [Vector2.RIGHT, Vector2.DOWN, Vector2.LEFT, Vector2.UP]

var cardinal_direction: Vector2 = Vector2.DOWN
var direction: Vector2 = Vector2.ZERO

var invulnerable: bool = false
var hp: int = 6

var max_hp: int = 6

@onready var animation_player: AnimationPlayer = $AnimationPlayer
@onready var effect_animation_player: AnimationPlayer = $EffectAnimationPlayer
@onready var hit_box: HitBox = $HitBox
@onready var sprite: Sprite2D = $Sprite2D
@onready var state_machine: PlayerStateMachine = $StateMachine
@onready var audio: AudioStreamPlayer2D = $Audio/AudioStreamPlayer2D

## A path determined by mouse input for guiding the player's movement.
var mouse_path: PackedVector2Array = []


# Called when the node enters the scene tree for the first time.
func _ready() -> void:
	PlayerManager.player = self
	state_machine.initialize(self)
	hit_box.damaged.connect(_take_damage)
	update_hp(99)


func _handle_move_click() -> void:
	Logger.debug("_unhandled_input:move_click")
	var click_position := get_global_mouse_position()
	request_path_to_target.emit(global_position, click_position, mouse_path)


func _handle_inventory() -> void:
	Logger.debug("_unhandled_input:inventory")
	InventoryManager.open_inventory()


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("move_click"):
		return _handle_move_click()
	if event.is_action_pressed("inventory"):
		return _handle_inventory()


# Called every frame. 'delta' is the elapsed time since the previous frame.
func _process(_delta: float) -> void:
	direction = (
		Vector2(Input.get_axis("move_left", "move_right"), Input.get_axis("move_up", "move_down"))
		. normalized()
	)


func _physics_process(_delta: float) -> void:
	move_and_slide()


func set_direction() -> bool:
	if direction == Vector2.ZERO:
		return false

	var direction_id: int = int(
		round((direction + cardinal_direction * 0.1).angle() / TAU * DIR_4.size())
	)
	var new_dir: Vector2 = DIR_4[direction_id]

	if new_dir == cardinal_direction:
		return false

	cardinal_direction = new_dir
	direction_changed.emit(new_dir)
	sprite.scale.x = -1 if cardinal_direction == Vector2.LEFT else 1
	return true


func update_animation(state: String) -> void:
	animation_player.play(state + "_" + anim_direction())


func anim_direction() -> String:
	if cardinal_direction == Vector2.DOWN:
		return "down"
	elif cardinal_direction == Vector2.UP:
		return "up"
	else:
		return "side"


func _take_damage(hurt_box: HurtBox) -> void:
	if invulnerable == true:
		return
	update_hp(-hurt_box.damage)
	if hp > 0:
		player_damaged.emit(hurt_box)
	else:
		player_damaged.emit(hurt_box)
		update_hp(99)
	pass


func update_hp(delta: int) -> void:
	hp = clampi(hp + delta, 0, max_hp)
	#Hud.update_hp(hp, max_hp)


func make_invulnerable(_duration: float = 1.0) -> void:
	invulnerable = true
	hit_box.monitoring = false

	await get_tree().create_timer(_duration).timeout

	invulnerable = false
	hit_box.monitoring = true
