extends Control
## ClockHUD.gd
## This script controls the display of day and time in a HUD, including an arrow to indicate AM/PM.

@onready var day_label_background: Label = %DayLabelBackground
@onready var day_label: Label = %DayLabel
@onready var time_label_background: Label = %TimeLabelBackground
@onready var time_label: Label = %TimeLabel
@onready var arrow: TextureRect = %Arrow


func _ready() -> void:
	TimeManager.game_time_changed.connect(set_clock)


## Sets the day and time on the HUD based on input parameters.


func set_clock(time: TimeManager.TimeModel) -> void:
	var day := time.day
	var hour := time.hour
	var minute := time.minute
	day_label.text = "Day " + str(day + 1)
	day_label_background.text = day_label.text

	time_label.text = (
		format_hour(hour) + ":" + format_minute(minute) + " " + get_period_suffix(hour)
	)
	time_label_background.text = time_label.text
	# Set arrow rotation based on AM or PM
	arrow.rotation_degrees = calculate_arrow_rotation(hour)


## Formats the hour for AM/PM display.
func format_hour(hour: int) -> String:
	var formatted_hour := hour % 12
	formatted_hour = formatted_hour if formatted_hour else 12
	return str(formatted_hour)


## Formats the minute with leading zero if necessary.
func format_minute(minute: int) -> String:
	if minute < 10:
		return "0" + str(minute)
	return str(minute)


## Determines the period suffix (AM/PM) based on the hour.
func get_period_suffix(hour: int) -> String:
	return "AM" if hour < 12 else "PM"


## Calculates the rotation of the arrow to indicate AM or PM visually.
func calculate_arrow_rotation(hour: float) -> float:
	return _remap_range(hour, 0, 12, -90, 90) if hour <= 12 else _remap_range(hour, 13, 23, 90, -90)


## Remaps a value from one range to another.
func _remap_range(
	value: float, from_start: float, from_end: float, to_start: float, to_end: float
) -> float:
	return (value - from_start) / (from_end - from_start) * (to_end - to_start) + to_start
