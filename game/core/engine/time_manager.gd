extends Node

## Signal to emit when the in-game time changes
signal game_time_changed(time: TimeModel)

const START_YEAR := 1030
const START_MONTH := 2  # February
const START_DAY := 18

const MINUTES_PER_DAY := 1440
const MINUTES_PER_HOUR := 60
const DAYS_IN_MONTH := 30
## Calculates the duration of an in-game minute in real-time seconds.
const INGAME_TO_REAL_MINUTE_DURATION := (2 * PI) / MINUTES_PER_DAY


class TimeModel:
	var day: int
	var hour: int
	var minute: int
	var total_in_game_minutes: int

	func _init(p_total_in_game_minutes: int) -> void:
		total_in_game_minutes = p_total_in_game_minutes
		day = total_in_game_minutes / MINUTES_PER_DAY
		hour = (total_in_game_minutes % MINUTES_PER_DAY) / MINUTES_PER_HOUR
		minute = total_in_game_minutes % MINUTES_PER_HOUR


const TIME_SPEED = 0.25

const SAVE_FREQUENCY_IN_GAME_MINUTES := 10

var total_delta_time := INGAME_TO_REAL_MINUTE_DURATION * MINUTES_PER_HOUR
var running := false

var _total_in_game_minutes := 0


func set_running(value: bool) -> void:
	running = value


func get_total_in_game_minutes() -> int:
	return int(total_delta_time / INGAME_TO_REAL_MINUTE_DURATION)


func get_total_game_time() -> TimeModel:
	return TimeModel.new(get_total_in_game_minutes())


## Prepares the initial state of the modulator based on the initial hour.
func _ready() -> void:
	SaveManager.load_game_data()
	if SaveManager.current_game_data:
		total_delta_time = (
			INGAME_TO_REAL_MINUTE_DURATION
			* MINUTES_PER_HOUR
			* SaveManager.current_game_data.total_in_game_hours
		)


## Updates the in-game time and adjusts the modulator's color based on the current time.
func _process(delta: float) -> void:
	if not running:
		return
	total_delta_time += delta * INGAME_TO_REAL_MINUTE_DURATION * TIME_SPEED
	var new_time := get_total_game_time()

	if _total_in_game_minutes == new_time.total_in_game_minutes:
		return
	_total_in_game_minutes = new_time.total_in_game_minutes
	game_time_changed.emit(new_time)

	if _total_in_game_minutes % SAVE_FREQUENCY_IN_GAME_MINUTES == 0:
		var game_data := SaveManager.get_save_data()
		game_data.total_in_game_hours = _total_in_game_minutes / MINUTES_PER_HOUR
		SaveManager.save_game_data(game_data)


## Convert time difference, both values is timestamps in game minutes.
func to_current_time_difference(in_game_minute: int) -> String:
	var difference := get_total_in_game_minutes() - in_game_minute
	if difference < 60:
		return "%s minutes ago" % difference
	if difference < 1440:
		return "%s hour(s) ago" % (difference / 60)
	if difference < 10080:
		return "%s day(s) ago" % (difference / 1440)

	return "%s week(s) ago" % (difference / 10080)


## Convert time difference, both values is timestamps in game minutes.
## Based on a constant date start, 18.02 1030
## @example: time is 3 day, 8 hour, 30 min _to_calender(time) => 21 of february 1030, 08:30
func to_calender(time: TimeModel) -> String:
	var total_days := START_DAY + time.day
	var months_passed := total_days / DAYS_IN_MONTH
	var current_day := total_days % DAYS_IN_MONTH
	var current_month := (START_MONTH + months_passed) % 12
	var years_passed := (START_MONTH + months_passed) / 12
	var current_year := START_YEAR + years_passed

	# Adjust for zero-based month and if day rolls over to next month without changing the month count
	if current_day == 0:
		current_day = DAYS_IN_MONTH
		current_month -= 1
	if current_month == 0:
		current_month = 12
		current_year -= 1

	var hour := time.hour
	var minute := time.minute
	# Format hour and minute to always be two digits
	var hour_str := str(hour).pad_zeros(2)
	var minute_str := str(minute).pad_zeros(2)

	# Format and return the calendar date
	return (
		"%s of %s %s, %s:%s"
		% [current_day, _get_month_name(current_month), current_year, hour_str, minute_str]
	)


# Helper function to convert month number to month name
func _get_month_name(month: int) -> String:
	var months := [
		"January",
		"February",
		"March",
		"April",
		"May",
		"June",
		"July",
		"August",
		"September",
		"October",
		"November",
		"December"
	]
	return months[month]
