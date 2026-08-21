class_name BaseAPI

var api_key: String


func _init(p_api_key: String) -> void:
	api_key = p_api_key


func dispose() -> void:
	pass


func get_headers(body: Variant) -> PackedStringArray:
	var headers: PackedStringArray = ["Authorization: Bearer %s" % api_key]
	if body is Dictionary:
		headers.append("Content-Type: application/json")
	return headers
