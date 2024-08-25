extends BaseImageAPI

signal download_completed(success: bool, path: String)

const URL: String = "https://api.openai.com/v1/images/generations"
const TEMPERATURE: float = 0.5
const MODEL: String = "dall-e-3"

var _client := HTTPRequestClient.new()


class DalleArgumentsModel:
	var prompt: String
	var n := 1
	var width := 256
	var height := 256

	func _init(input: ImageInputModel) -> void:
		prompt = input.prompt
		if input.width:
			width = input.width
		if input.height:
			height = input.height

	func to_json() -> Dictionary:
		var size := "%sx%s" % [width, height]
		return {"prompt": prompt, "n": n, "size": size}


func generate_image(input: ImageInputModel) -> ImageOutputModel:
	var image_path := to_image_path(input.directory, input.file_name, ImageType.PNG)

	var body := DalleArgumentsModel.new(input)

	_client.make_request(URL, api_key, body.to_json())
	var response: Array = await _client.http_request_completed
	var error: Variant = response[1]

	var output := ImageOutputModel.new()
	if error:
		printerr("call_dalle:error\n" + str(error))
		output.error = error
		return output
	var parsed_response: Dictionary = response[0]
	var url: String = parsed_response.data[0].url
	Logger.debug("call_dalle:url", url)
	await download_file(url, image_path)

	if not FileAccess.file_exists(image_path):
		printerr("File does not exist: ", image_path)
		return

	output.file_path = image_path
	return output


func download_file(url: String, path: String) -> void:
	var directory := path.get_base_dir()
	if not DirAccess.dir_exists_absolute(directory):
		DirAccess.make_dir_recursive_absolute(directory)

	var http_request := _client.init_http_request()
	http_request.connect("request_completed", _on_download_completed)
	http_request.set_download_file(path)
	http_request.request(url)
	await download_completed
	http_request.queue_free()


func _on_download_completed(
	result: int, response_code: int, _headers: PackedStringArray, body: PackedByteArray
) -> void:
	if result == HTTPRequest.RESULT_SUCCESS and response_code == 200:
		download_completed.emit(true, body.get_string_from_utf8())
	else:
		download_completed.emit(false, "")
