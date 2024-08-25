class_name BaseImageAPI
extends BaseAPI
enum ImageType { PNG, JPG }

const IMAGE_TYPE_MAP := {
	ImageType.PNG: "png",
	ImageType.JPG: "jpg",
}


class ImageInputModel:
	var prompt: String
	var directory: String
	var file_name: String
	var width: int
	var height: int


class ImageOutputModel:
	var file_path: String
	var error: Variant


func generate_image(_input: ImageInputModel) -> ImageOutputModel:
	assert(false, "Not implemented")
	var response: ImageOutputModel = await SignalManager.processed
	return response


func to_image_path(directory: String, file_name: String, image_type: ImageType) -> String:
	var image_file_extension: String = IMAGE_TYPE_MAP[image_type]
	return "%s/%s.%s" % [directory, file_name, image_file_extension]
