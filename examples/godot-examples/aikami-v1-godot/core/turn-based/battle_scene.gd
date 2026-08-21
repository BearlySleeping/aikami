class_name BattleScene
extends Node2D

const MOCK_ENEMIES_IDS: Array[NPCManager.PredefinedNPC] = [
	NPCManager.PredefinedNPC.TROLL,
	NPCManager.PredefinedNPC.ORC,
]

const MOCK_ALLIES_IDS: Array[NPCManager.PredefinedNPC] = [
	NPCManager.PredefinedNPC.NONE,  # The player
	NPCManager.PredefinedNPC.ARAGON,
]

@onready var enemy_group: UnitGroup = %EnemyGroup
@onready var party_group: UnitGroup = %PartyGroup
@onready var command_menu: CommandMenu = %CommandMenu
@onready var battle_ended: Node2D = $BattleEnded


func _ready() -> void:
	Global.test_set_playground_mode()
	_populate_unit_groups()
	TurnManager.add_units(party_group.units + enemy_group.units)

	TurnManager.turn_started.connect(_on_turn_started)
	TurnManager.targeting_started.connect(_on_targeting_started)
	TurnManager.battle_ended.connect(_on_battle_ended)
	command_menu.command_selected.connect(_on_command_selected)

	_setup_input_handling()
	TurnManager.start_battle_cycle()


func _setup_input_handling() -> void:
	Input.set_custom_mouse_cursor(null)


func _populate_unit_groups() -> void:
	enemy_group.initialize(Enum.UnitType.ENEMY, MOCK_ENEMIES_IDS)
	party_group.initialize(Enum.UnitType.PARTY, MOCK_ALLIES_IDS)


func _on_turn_started(unit: Unit) -> void:
	if unit.unit_type == Enum.UnitType.PARTY and TurnManager.current_unit_index == 0:
		command_menu.show()
	else:
		command_menu.hide()


func _on_command_selected(command: Resource) -> void:
	TurnManager.start_targeting(command)


func _ai_take_turn(unit: Unit) -> void:
	var target := party_group.units[0]
	target.take_damage(unit.attack)
	TurnManager.end_turn()


func _on_battle_ended(winner: String) -> void:
	print("Battle ended! Winner:", winner)
	battle_ended.text = winner
	battle_ended.show()


func _on_targeting_started(_p_valid_targets: Array[Unit]) -> void:
	var current_target_index := 0
	var valid_targets := TurnManager.valid_targets
	valid_targets[current_target_index].focus()

	# Handle targeting input
	while TurnManager.current_state == TurnManager.BattleState.SELECTING_TARGET:
		if Input.is_action_just_pressed("ui_up") and current_target_index > 0:
			valid_targets[current_target_index].unfocus()
			current_target_index -= 1
			valid_targets[current_target_index].focus()
		elif (
			Input.is_action_just_pressed("ui_down")
			and current_target_index < valid_targets.size() - 1
		):
			valid_targets[current_target_index].unfocus()
			current_target_index += 1
			valid_targets[current_target_index].focus()
		elif Input.is_action_just_pressed("ui_accept"):
			TurnManager.execute_command(
				TurnManager.selected_command, valid_targets[current_target_index]
			)
			valid_targets[current_target_index].unfocus()
			break
		await get_tree().process_frame

	TurnManager.targeting_ended.emit()
