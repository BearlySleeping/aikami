class_name SpriteSheetUpdater


## Updates sprite frames from a sprite sheet based on the given AnimationModel
## Usage:
## [codeblock]
##const animation_positions = {
##	"idle_front": [0, 0],
##	"idle_side": [1, 0],
##	"idle_back": [2, 0],
##	"walk_front": [3, 0],
##	"walk_side": [4, 0],
##	"walk_back": [5, 0],
##	"attack_front": [6, 0],
##	"attack_side": [7, 0],
##	"attack_back": [8, 0],
##	"death": [9, 0]
##}
##var playerAnimationModel = AnimationModel.new(animation_positions, 6, 10)
##SpriteSheetUpdater.update_sprite_frames_with_new_sheet(animated_sprite_2d,
##   "new_sprite.png", playerAnimationModel)
## [/codeblock]
static func update_sprite_frames_with_new_sheet(
	animated_sprite_2d: AnimatedSprite2D, new_sheet_path: String, animation_model: AnimationModel
) -> void:
	var cols := animation_model.columns
	var rows := animation_model.rows
	var animation_positions := animation_model.animation_positions

	# Load the new sprite sheet as a Texture
	var image := Image.load_from_file(new_sheet_path)

	# TODO: validate the frame width and height
	#var frame_width = image.get_width() / cols
	var frame_height: int = image.get_height() / rows

	# Update frames
	var sprite_frames := animated_sprite_2d.sprite_frames
	for anim_name: String in animation_positions.keys():
		if not sprite_frames.has_animation(anim_name):
			push_error("Animation %s not found in the sprite_frames" % anim_name)
			continue

		var frame_count := sprite_frames.get_frame_count(anim_name)
		var position: Array[int] = animation_positions[anim_name]
		var row := position[0]
		var start_col := position[1]
		for frame_idx in range(frame_count):
			var col := (start_col + frame_idx) % cols
			var frame_region := Rect2(
				col * frame_height, row * frame_height, frame_height, frame_height
			)

			var frame_image := image.get_region(frame_region)
			var frame_texture := ImageTexture.create_from_image(frame_image)
			sprite_frames.set_frame(anim_name, frame_idx, frame_texture)


static func replace_color_with_transparency(
	image: Image, color_to_replace: Color, tolerance: float = 0.01
) -> Image:
	for x in range(image.get_width()):
		for y in range(image.get_height()):
			var current_color := image.get_pixel(x, y)
			if _is_color_similar(current_color, color_to_replace, tolerance):
				image.set_pixel(x, y, Color(0, 0, 0, 0))  # Replace with transparent
	return image


static func _is_color_similar(color1: Color, color2: Color, tolerance: float) -> bool:
	return (
		abs(color1.r - color2.r) < tolerance
		&& abs(color1.g - color2.g) < tolerance
		&& abs(color1.b - color2.b) < tolerance
		&& abs(color1.a - color2.a) < tolerance
	)
