class_name Level extends Node2D

@export var player: Player
@export var portals: Array[Portal]
var data: LevelDataHandoff


func _ready() -> void:
	player.disable()
	player.visible = false
	# if we aren't transitioning between levels,
	# we don't need to wait for the SceneManager to call this
	if not data:
		enter_level()


func enter_level() -> void:
	if data:
		init_player_location()
	player.enable()
	_connect_to_portals()


# put player in front of the correct portal, facing the correct direction
func init_player_location() -> void:
#	var portals = find_children("*","Portal")
	if not data:
		return
	for portal in portals:
		if portal.name == data.entry_portal_name:
			player.position = portal.get_player_entry_vector()
	player.orient(data.move_dir)


# signal emitted by Portal
# disables portals and players
# create handoff data to pass to the new scene (if new scene is a Level)
func _on_player_entered_portal(portal: Portal) -> void:
	_disconnect_from_portals()
	player.disable()
	player.queue_free()
	data = LevelDataHandoff.new()
	data.entry_portal_name = portal.entry_portal_name
	data.move_dir = portal.get_move_dir()
	set_process(false)


func _connect_to_portals() -> void:
	for portal in portals:
		if not portal.player_entered_portal.is_connected(_on_player_entered_portal):
			portal.player_entered_portal.connect(_on_player_entered_portal)


func _disconnect_from_portals() -> void:
	for portal in portals:
		if portal.player_entered_portal.is_connected(_on_player_entered_portal):
			portal.player_entered_portal.disconnect(_on_player_entered_portal)
