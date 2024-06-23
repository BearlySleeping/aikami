extends Node

## The names of the songs.
## Notes these are song from the album Dead but Dreaming by vivivivivi:
## https://tech-noir1.bandcamp.com/album/dead-but-dreaming
## We don't have the rights it is just placeholder to vibe while debugging
enum TrackName {
	ALONE,
	ANGELS,
	AVAIL,
	CREATION,
	DAWN,
	DETRITUS,
	FUTILE,
	GUTS,
	NOTHING_LASTS,
	REMAINS,
	SKY,
	TORTURE_MACHINES,
	WASTE
}
enum SFXName { MENU }

const TRACKS = {
	TrackName.ALONE: "res://audio/music/alone.ogg",
	TrackName.ANGELS: "res://audio/music/angels.ogg",
	TrackName.AVAIL: "res://audio/music/avail.ogg",
	TrackName.CREATION: "res://audio/music/creation.ogg",
	TrackName.DAWN: "res://audio/music/dawn.ogg",
	TrackName.DETRITUS: "res://audio/music/detritus.ogg",
	TrackName.FUTILE: "res://audio/music/futile.ogg",
	TrackName.GUTS: "res://audio/music/guts.ogg",
	TrackName.NOTHING_LASTS: "res://audio/music/nothing_lasts.ogg",
	TrackName.REMAINS: "res://audio/music/remains.ogg",
	TrackName.SKY: "res://audio/music/sky.ogg",
	TrackName.TORTURE_MACHINES: "res://audio/music/torture_machines.ogg",
	TrackName.WASTE: "res://audio/music/waste.ogg",
}

const SFXS = {SFXName.MENU: "res://assets/audio/sfx/menu.wav"}

@onready var _animation_player := $AnimationPlayer
@onready var _music_player := $MusicStreamPlayer
@onready var _sfx_stream_player: AudioStreamPlayer = $SFXStreamPlayer


func play_button_sound() -> void:
	return play_sfx(SFXName.MENU)


func play_sfx(sfx_name: SFXName) -> void:
	Logger.info("play_sfx", sfx_name)
	var new_stream := _get_sfx_stream(sfx_name)
	_sfx_stream_player.stream = new_stream
	_sfx_stream_player.play()


## This function plays a song.
## @param songName The name of the song to play. see [enum TrackName]
## @param time_in The time it takes to fade in.
## @param time_out The time it takes to fade out.
## @returns void
func play_track(track_name: TrackName, time_in := 0.0, time_out := 0.0) -> void:
	Logger.info("play_track", track_name)
	var new_stream := _get_track_stream(track_name)
	if new_stream == _music_player.stream:
		return

	if _music_player.playing:
		await _fade_track(false, time_out)
		_music_player.stop()

	_music_player.stream = new_stream
	_music_player.volume_db = -50.0
	_music_player.play()
	await _fade_track(true, time_in)


## This function stops the song.
## @param time_out The time it takes to fade out.
## @returns void
func stop_track(time_out := 0.0) -> void:
	await _fade_track(false, time_out)
	_music_player.stop()


func _get_track_stream(track_name: TrackName) -> AudioStream:
	if track_name in TRACKS:
		return load(TRACKS[track_name])

	push_error("track_name %s not found" % track_name)
	return null


func _get_sfx_stream(sfx_name: SFXName) -> AudioStream:
	if sfx_name in SFXS:
		return load(SFXS[sfx_name])

	push_error("sfx_name %s not found" % sfx_name)
	return null


func _fade_track(should_fade_track_in: bool, time_out: float) -> void:
	if is_equal_approx(time_out, 0.0):
		time_out = 0.005

	_animation_player.speed_scale = 1.0 / time_out
	_animation_player.play("fade_in" if should_fade_track_in else "fade_out")
	await _animation_player.animation_finished
