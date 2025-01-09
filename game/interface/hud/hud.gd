extends CanvasLayer

@export var button_focus_audio: AudioStream = preload("res://assets/audio/sfx/menu.wav")
@export var button_select_audio: AudioStream = preload("res://assets/audio/sfx/bars_open.wav")

var hearts: Array[HeartGUI] = []

@onready var game_over: Control = $Control/GameOver
@onready var continue_button: Button = $Control/GameOver/VBoxContainer/ContinueButton
@onready var title_button: Button = $Control/GameOver/VBoxContainer/TitleButton
@onready var animation_player: AnimationPlayer = $Control/GameOver/AnimationPlayer
@onready var audio: AudioStreamPlayer = $AudioStreamPlayer

@onready var boss_ui: Control = $Control/BossUI
@onready var boss_hp_bar: TextureProgressBar = $Control/BossUI/TextureProgressBar
@onready var boss_label: Label = $Control/BossUI/Label

@onready var notification_ui: NotificationUI = $Control/Notification

@onready var player_life_ui: HFlowContainer = %PlayerLifeUI


func _ready() -> void:
	for child in player_life_ui.get_children():
		if child is HeartGUI:
			hearts.append(child)
			child.visible = false

	hide_game_over_screen()
	continue_button.focus_entered.connect(play_audio.bind(button_focus_audio))
	continue_button.pressed.connect(load_game)
	title_button.focus_entered.connect(play_audio.bind(button_focus_audio))
	title_button.pressed.connect(title_screen)
	SceneManager.scene_loaded.connect(hide_game_over_screen)

	hide_boss_health()


func update_hp(hp: int, max_hp: int) -> void:
	update_max_hp(max_hp)
	for i in max_hp:
		update_heart(i, hp)


func update_heart(index: int, hp: int) -> void:
	var value: int = clampi(hp - index * 2, 0, 2)
	hearts[index].value = value


func update_max_hp(max_hp: int) -> void:
	var heart_count: int = roundi(max_hp * 0.5)
	for i in hearts.size():
		if i < heart_count:
			hearts[i].visible = true
		else:
			hearts[i].visible = false


func show_game_over_screen() -> void:
	game_over.visible = true
	game_over.mouse_filter = Control.MOUSE_FILTER_STOP

	var can_continue: bool = SaveManager.get_save_file() != null
	continue_button.visible = can_continue

	animation_player.play("show_game_over")
	await animation_player.animation_finished

	if can_continue == true:
		continue_button.grab_focus()
	else:
		title_button.grab_focus()


func hide_game_over_screen() -> void:
	game_over.visible = false
	game_over.mouse_filter = Control.MOUSE_FILTER_IGNORE
	game_over.modulate = Color(1, 1, 1, 0)


func load_game() -> void:
	play_audio(button_select_audio)
	await fade_to_black()
	SaveManager.load_game()


func title_screen() -> void:
	play_audio(button_select_audio)
	await fade_to_black()
	SceneManager.load_new_scene("res://interface/menus/main/main_menu.tscn", "", Vector2.ZERO)


func fade_to_black() -> bool:
	animation_player.play("fade_to_black")
	await animation_player.animation_finished
	PlayerManager.player.revive_player()
	return true


func play_audio(_a: AudioStream) -> void:
	audio.stream = _a
	audio.play()


func show_boss_health(boss_name: String) -> void:
	boss_ui.visible = true
	boss_label.text = boss_name
	update_boss_health(1, 1)


func hide_boss_health() -> void:
	boss_ui.visible = false


func update_boss_health(hp: int, max_hp: int) -> void:
	boss_hp_bar.value = clampf(float(hp) / float(max_hp) * 100, 0, 100)


func queue_notification(_title: String, _message: String) -> void:
	notification_ui.add_notification_to_queue(_title, _message)


func hide_hud() -> void:
	visible = false


func show_hud() -> void:
	visible = true
