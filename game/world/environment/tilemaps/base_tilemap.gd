class_name BaseTileMap
extends TileMapLayer

## Instance of AStarGrid2D for pathfinding within the tilemap.
var _astar := AStarGrid2D.new()

## Defines the bounds of the tilemap where navigation is possible.
var _tilemap_bounds: Rect2i


# Initializes the AStarGrid2D with the tilemap's dimensions and configures pathfinding.
func _ready() -> void:
	# Calculate the size of the tilemap based on used tiles.
	var tile_size := tile_set.tile_size
	var tilemap_size := get_used_rect().end - get_used_rect().position
	_tilemap_bounds = Rect2i(Vector2i(), tilemap_size)

	# Set the navigation region, cell size, and offset for the AStarGrid2D.
	_astar.region = _tilemap_bounds
	_astar.cell_size = tile_size
	_astar.offset = tile_size * 0.5
	_astar.default_compute_heuristic = AStarGrid2D.HEURISTIC_EUCLIDEAN
	_astar.default_estimate_heuristic = AStarGrid2D.HEURISTIC_EUCLIDEAN
	_astar.update()

	# Loop through the tilemap to identify and mark solid (non-walkable) points.
	for x in range(tilemap_size.x):
		for y in range(tilemap_size.y):
			var coordinates := Vector2i(x, y)
			# Check if a tile is marked as a 'wall' (or non-walkable).
			var tile_data := get_cell_tile_data(coordinates)
			if tile_data and tile_data.get_custom_data("solid"):
				_astar.set_point_solid(coordinates)


## Determines if a given point in local space is walkable..
func is_point_walkable(local_position: Vector2i) -> bool:
	var map_position := local_to_map(local_position)
	return _tilemap_bounds.has_point(map_position) and not _astar.is_point_solid(map_position)


## Calculates and updates a path from a start to an end point within the tilemap.
func get_path_to_point(
	start_position: Vector2i, end_position: Vector2i, path: PackedVector2Array
) -> void:
	path.clear()
	if not is_point_walkable(end_position):
		Logger.warn("get_path_to_point: not walkable point", end_position)
		return

	# Convert start and end positions to map coordinates,
	# calculate the path, and convert back to local coordinates.
	path.append_array(
		_astar.get_id_path(local_to_map(start_position), local_to_map(end_position)).slice(1).map(
			map_to_local
		)
	)
