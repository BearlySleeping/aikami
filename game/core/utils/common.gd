class_name Utils


static func get_random_int(max_value: int) -> int:
	randomize()
	return randi() % max_value


static func random_bytes(n: int) -> Array[int]:
	var r: Array[int] = []
	for index in range(0, n):
		r.append(get_random_int(256))
	return r


static func uuidbin() -> Array[int]:
	var b := random_bytes(16)

	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return b


static func v4() -> String:
	var b := uuidbin()

	var low := "%02x%02x%02x%02x" % [b[0], b[1], b[2], b[3]]
	var mid := "%02x%02x" % [b[4], b[5]]
	var hi := "%02x%02x" % [b[6], b[7]]
	var clock := "%02x%02x" % [b[8], b[9]]
	var node := "%02x%02x%02x%02x%02x%02x" % [b[10], b[11], b[12], b[13], b[14], b[15]]

	return "%s-%s-%s-%s-%s" % [low, mid, hi, clock, node]


## Use this for dynamic generated images, for images in the project use load(...)
static func get_image_texture_from_path(image_path: String) -> ImageTexture:
	var image := Image.new()
	var failed_to_load_image := image.load(image_path)

	if failed_to_load_image:
		printerr("get_image_texture_from_path:failed_to_load_image\n" + str(failed_to_load_image))
		return
	return ImageTexture.create_from_image(image)


## Capitalize the first letter of a string and make the rest lowercase
static func capitalize_first_letter(input: String) -> String:
	# Return early if the input is empty
	if input.length() == 0:
		return input

	# Capitalize the first letter and make the rest lowercase
	return input.substr(0, 1).to_upper() + input.substr(1, input.length() - 1).to_lower()
