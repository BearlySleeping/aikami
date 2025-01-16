extends CanvasLayer
class_name CommandMenu

signal command_selected(command: Resource)

@onready var attack_button: Button = %AttackButton
@onready var skills_button: Button = %SkillsButton
@onready var run_button: Button = %RunButton

@onready var main_commands: VBoxContainer = %MainCommands
@onready var skill_container: VBoxContainer = %SkillCommands

const COMMAND_BUTTON = preload("res://core/turn-based/command_menu/command_button.tscn")

var attack := SkillResource.new("Attack", SkillResource.TARGET_TYPE.ENEMIES)

var skills: Array[SkillResource] = [
	SkillResource.new("Heal", SkillResource.TARGET_TYPE.PLAYERS),
	SkillResource.new("Slash", SkillResource.TARGET_TYPE.ENEMIES)
]


func _ready() -> void:
	attack_button.pressed.connect(_on_command_pressed.bind(attack))
	skills_button.pressed.connect(_on_skill_button_pressed)
	run_button.pressed.connect(_on_run_button_pressed)

	attack_button.grab_focus()

	_set_skill_commands()


func _on_command_pressed(command: Resource) -> void:
	hide()

	command_selected.emit(command)

	main_commands.show()
	skill_container.hide()

	attack_button.grab_focus()


func _on_skill_button_pressed() -> void:
	main_commands.hide()
	skill_container.show()

	skill_container.get_children()[0].grab_focus()


func _on_run_button_pressed() -> void:
	TurnManager.run()


func _set_skill_commands() -> void:
	for skill in skills:
		var new_skill_button: Button = COMMAND_BUTTON.instantiate()
		new_skill_button.text = skill.name
		new_skill_button.pressed.connect(_on_command_pressed.bind(skill))
		skill_container.add_child(new_skill_button)


func reset() -> void:
	main_commands.show()
	skill_container.hide()
	attack_button.grab_focus()
