@tool
extends NPCBehavior

const COLORS = [
	Color(1, 0, 0), Color(1, 1, 0), Color(0, 1, 0), Color(0, 1, 1), Color(0, 0, 1), Color(1, 0, 1)
]

@export var walk_speed: float = 30.0

var patrol_locations: Array[PatrolLocation]
var current_location_index: int = 0
var target: PatrolLocation


func _ready() -> void:
	gather_patrol_locations()
	if Engine.is_editor_hint():
		child_entered_tree.connect(gather_patrol_locations)
		child_order_changed.connect(gather_patrol_locations)
		return
	super()
	if patrol_locations.size() == 0:
		process_mode = Node.PROCESS_MODE_DISABLED
		return
	target = patrol_locations[0]


func _process(_delta: float) -> void:
	if Engine.is_editor_hint():
		return
	if npc.global_position.distance_to(target.target_position) < 1:
		start()


func gather_patrol_locations(_n: Node = null) -> void:
	patrol_locations = []
	for c in get_children():
		if c is PatrolLocation:
			patrol_locations.append(c)

	if Engine.is_editor_hint():
		if patrol_locations.size() > 0:
			for i in patrol_locations.size():
				var patrol_location := patrol_locations[i] as PatrolLocation

				if not patrol_location.transform_changed.is_connected(gather_patrol_locations):
					patrol_location.transform_changed.connect(gather_patrol_locations)

				patrol_location.update_label(str(i))
				patrol_location.modulate = _get_color_by_index(i)

				var next_location: PatrolLocation
				if i < patrol_locations.size() - 1:
					next_location = patrol_locations[i + 1]
				else:
					next_location = patrol_locations[0]
				patrol_location.update_line(next_location.position)


func start() -> void:
	if npc.do_behavior == false or patrol_locations.size() < 2:
		return

	# IDLE PHASE
	npc.global_position = target.target_position
	npc.state = "idle"
	npc.velocity = Vector2.ZERO
	npc.update_animation()

	var wait_time: float = target.wait_time

	current_location_index += 1
	if current_location_index >= patrol_locations.size():
		current_location_index = 0

	target = patrol_locations[current_location_index]

	await get_tree().create_timer(wait_time).timeout

	if npc.do_behavior == false:
		return

	npc.state = "walk"
	var direction := global_position.direction_to(target.target_position)
	npc.direction = direction
	npc.velocity = walk_speed * direction
	npc.update_direction(target.target_position)
	npc.update_animation()


func _get_color_by_index(i: int) -> Color:
	var color_count: int = COLORS.size()
	while i > color_count - 1:
		i -= color_count
	return COLORS[i]
