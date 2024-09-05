@tool
extends CanvasLayer

const BACKGROUND_COLOR: int = 0xffffffff
var current_player: PlayerModel
@onready var name_input: LineEdit = %NameInput
@onready var gender_option: OptionButton = %GenderOption
@onready var race_option: OptionButton = %RaceOption
@onready var class_option: OptionButton = %ClassOption
@onready var age_spin_box: SpinBox = %AgeSpinBox
@onready var appearance_input: TextEdit = %AppearanceInput
@onready var generate_button: Button = %GenerateButton
@onready var save_button: Button = %SaveButton
@onready var avatar_frame: TextureRect = %AvatarFrame

func _ready() -> void:
	save_button.disabled = true
	_populate_option_button(gender_option, Enum.Gender.keys())
	_populate_option_button(race_option, Enum.Race.keys())
	_populate_option_button(class_option, Enum.Class.keys())


func _populate_option_button(option_button: OptionButton, enum_values: PackedStringArray) -> void:
	option_button.clear()
	for value in enum_values:
		var readable_name: String = value.to_pascal_case()
		option_button.add_item(readable_name)


func _on_generate_button_pressed() -> void:
	generate_button.disabled = true
	current_player = PlayerModel.new(
		{
			"name": name_input.text,
			"gender": gender_option.selected,
			"race": race_option.selected,
			"character_class": class_option.selected,
			"age": int(age_spin_box.value),
			"appearance": appearance_input.text.split(",", false)
		}
	)
	Logger.info("Creating character with the following details", current_player.to_dict())

	# Create a prompt using the character attributes
	var prompt_elements: PackedStringArray = PackedStringArray(
		[
			"an RPG character avatar",
			"visible from the chest up",
			"no text",
			"background color: " + str(BACKGROUND_COLOR),
			"Gender: " + Enum.Gender.keys()[current_player.gender].to_lower(),
			"class: " + Enum.Class.keys()[current_player.character_class].to_lower(),
			"race: " + Enum.Race.keys()[current_player.race].to_lower(),
			"age: " + str(current_player.age),
			"appearance: " + ", ".join(current_player.appearance)
		]
	)

	var prompt: String = "\n".join(prompt_elements)

	var input := BaseImageAPI.ImageInputModel.new()
	input.prompt = prompt
	input.directory = Global.get_save_path("save/player")
	input.file_name = "avatar"
	var response := await AIManager.generate_image(input)
	generate_button.disabled = false
	if response.error:
		return
	var avatar_path := response.file_path
	current_player.avatar_path = avatar_path
	avatar_frame.texture = Utils.get_image_texture_from_path(avatar_path)
	save_button.disabled = false


func _on_save_button_pressed() -> void:
	if !current_player:
		return
	SaveManager.save_player_data(current_player)
	SceneManager.load_new_fixed_scene(SceneManager.SceneName.MAIN, "fade_to_black")
