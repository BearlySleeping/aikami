# TurnManager
extends Node

signal turn_started(unit: Unit)
signal turn_ended
signal battle_ended(winner: String)
signal targeting_started(valid_targets: Array[Unit])
signal targeting_ended

enum BattleState { IDLE, SELECTING_ACTION, SELECTING_TARGET, EXECUTING_ACTION }

var units: Array[Unit] = []
var current_unit_index: int = 0
var active_unit: Unit = null
var current_state: BattleState = BattleState.IDLE
var valid_targets: Array[Unit] = []
var selected_command: SkillResource = null


func start_battle_cycle() -> void:
	if units.is_empty():
		push_error("No units available for battle.")
		return
	current_unit_index = 0
	_start_turn()


func _start_turn() -> void:
	if units.is_empty():
		return

	active_unit = units[current_unit_index]
	if active_unit.health <= 0:
		end_turn()
		return

	turn_started.emit(active_unit)

	if active_unit.unit_type == Enum.UnitType.PARTY and current_unit_index == 0:
		current_state = BattleState.SELECTING_ACTION
	else:
		_execute_ai_turn()


func execute_command(command: SkillResource, target: Unit) -> void:
	if command.name == "Attack":
		target.take_damage(active_unit.attack)
	# Add other command types here

	current_state = BattleState.IDLE
	end_turn()


func _execute_ai_turn() -> void:
	await get_tree().create_timer(0.5).timeout  # Add delay for better visualization

	var target: Unit
	if active_unit.unit_type == Enum.UnitType.ENEMY:
		target = _get_random_alive_target(Enum.UnitType.PARTY)
	else:
		target = _get_best_target_for_ally()

	execute_command(SkillResource.new("Attack", SkillResource.TargetType.ENEMIES), target)


func start_targeting(command: SkillResource) -> void:
	selected_command = command
	current_state = BattleState.SELECTING_TARGET
	valid_targets = _get_valid_targets(command.target_type)
	targeting_started.emit(valid_targets)


func _get_valid_targets(target_type: SkillResource.TargetType) -> Array[Unit]:
	var targets: Array[Unit] = []
	for unit in units:
		if unit.health <= 0:
			continue

		if (
			target_type == SkillResource.TargetType.ENEMIES
			and unit.unit_type == Enum.UnitType.ENEMY
		):
			targets.append(unit)
		elif (
			target_type == SkillResource.TargetType.PLAYERS
			and unit.unit_type == Enum.UnitType.PARTY
		):
			targets.append(unit)

	return targets


func _get_random_alive_target(target_type: Enum.UnitType) -> Unit:
	var targets := units.filter(
		func(unit: Unit) -> bool: return unit.unit_type == target_type and unit.health > 0
	)
	return targets[randi() % targets.size()] if not targets.is_empty() else null


func _get_best_target_for_ally() -> Unit:
	var party_members: Array[Unit] = units.filter(
		func(unit: Unit) -> bool: return unit.unit_type == Enum.UnitType.PARTY and unit.health > 0
	)

	# Simple AI: Heal the most damaged ally
	var lowest_health_ratio := 1.0
	var target: Unit = party_members[0]

	for unit in party_members:
		var health_ratio := float(unit.health) / unit.max_health
		if health_ratio < lowest_health_ratio:
			lowest_health_ratio = health_ratio
			target = unit

	return target


func end_turn() -> void:
	current_unit_index = (current_unit_index + 1) % units.size()
	if _check_battle_end():
		return
	turn_ended.emit()
	_start_turn()


func add_units(new_units: Array[Unit]) -> void:
	units.append_array(new_units)


func _check_battle_end() -> bool:
	var allies_alive := units.filter(self._is_party_unit_alive).size()
	var enemies_alive := units.filter(self._is_enemy_unit_alive).size()

	if allies_alive == 0:
		battle_ended.emit("enemies")
		return true
	if enemies_alive == 0:
		battle_ended.emit("party")
		return true

	return false


func _is_party_unit_alive(unit: Unit) -> bool:
	return unit.unit_type == Enum.UnitType.PARTY and unit.health > 0


func _is_enemy_unit_alive(unit: Unit) -> bool:
	return unit.unit_type == Enum.UnitType.ENEMY and unit.health > 0


func remove_unit(unit: Unit) -> void:
	units.erase(unit)
	if active_unit == unit:
		end_turn()


# User tries to run from the battle
func run() -> void:
	pass
