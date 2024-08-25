class_name HuggingFaceImageAPI
extends BaseImageAPI


# Parameters class definition
class Parameters:
	## An optional negative prompt for the image generation
	var negative_prompt: String

	## The height in pixels of the generated image
	var height := 256

	## The width in pixels of the generated image
	var width := 256

	## The number of denoising steps.
	## More denoising steps usually lead to a higher quality image at the expense of slower inference.
	var num_inference_steps: int

	## Guidance scale: Higher guidance scale encourages to generate images that are closely linked
	## to the text `prompt`, usually at the expense of lower image quality.
	var guidance_scale: float

	func to_json() -> Dictionary:
		var dict := {
			"height": height,
			"width": width,
		}
		if guidance_scale:
			dict.guidance_scale = guidance_scale
		if num_inference_steps:
			dict.num_inference_steps = num_inference_steps
		if negative_prompt:
			dict.negative_prompt = negative_prompt
		return dict


# BaseArgs class definition
class BaseArgs:
	## The access token to use. Without it, you'll get rate-limited quickly.
	var access_token: String

	## The model to use. Can be a full URL for a dedicated inference endpoint.
	var model: String

	## The text to generate an image from
	var inputs: String

	## Parameters for image generation
	var parameters: Parameters

	func _init(input: ImageInputModel) -> void:
		inputs = input.prompt

		parameters = Parameters.new()
		if input.height:
			parameters.height = input.height
		if input.width:
			parameters.width = input.width
		parameters.negative_prompt = "blurry"
		parameters.num_inference_steps = 30
		parameters.guidance_scale = 7.5

	# Method to convert class variables to a JSON string
	func to_json() -> Dictionary:
		var dict := {
			"accessToken": access_token,
			"model": model,
			"inputs": inputs,
		}
		if parameters:
			dict["parameters"] = parameters.to_json()

		return dict


const HF_INFERENCE_API_BASE_URL = "https://api-inference.huggingface.co"

const HUGGING_FACE_IMAGE_MODEL = "stabilityai/stable-diffusion-2"

var _client := HTTPRequestClient.new()


## This task reads some text input and outputs an image.
## Recommended model: stabilityai/stable-diffusion-2
##
func generate_image(input: ImageInputModel) -> ImageOutputModel:
	var image_path := to_image_path(input.directory, input.file_name, ImageType.JPG)

	var body := BaseArgs.new(input)

	body.access_token = api_key
	body.model = HUGGING_FACE_IMAGE_MODEL
	var url := _get_url(HUGGING_FACE_IMAGE_MODEL)
	_client.make_request(url, api_key, body.to_json())
	var response: Array = await _client.http_request_completed
	var parsed_response: PackedByteArray = response[0]
	var error: Variant = response[1]
	var output := ImageOutputModel.new()
	if error:
		printerr("call_gpt:error\n" + str(error))
		output.error = error
		return output

	var file := FileAccess.open(image_path, FileAccess.WRITE)
	if !file:
		push_error("Could not save")
		output.error = error
		return output
	file.store_buffer(parsed_response)
	file.close()

	var image := Image.new()
	var failed_to_load_image := image.load(image_path)
	if failed_to_load_image:
		printerr("Failed to create image from data.", failed_to_load_image)
		output.error = failed_to_load_image
		return output

	Logger.info("Image saved successfully at:" + image_path)
	output.file_path = image_path
	output.image = image
	return output


func _get_url(model_or_url: String) -> String:
	if is_url(model_or_url):
		return model_or_url

	return "%s/models/%s" % [HF_INFERENCE_API_BASE_URL, model_or_url]


# Checks if the given string is a URL.
#
# @param model_or_url String: The string to check.
# @return bool: Whether the string is a URL.
func is_url(model_or_url: String) -> bool:
	return (
		model_or_url.begins_with("http://")
		or model_or_url.begins_with("https://")
		or model_or_url.begins_with("/")
	)
