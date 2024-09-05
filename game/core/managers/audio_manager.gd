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


var music_audio_player_count : int = 2
var current_music_player_index : int = 0
var music_players : Array[ AudioStreamPlayer ] = []
var music_bus : String = "Music"
var _sfx_stream_player: AudioStreamPlayer
var music_fade_duration : float = 0.5


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_sfx_stream_player = AudioStreamPlayer.new()
	add_child( _sfx_stream_player )

	for i in music_audio_player_count:
		var player := AudioStreamPlayer.new()
		add_child( player )
		player.bus = music_bus
		music_players.append( player )
		player.volume_db = -40



func play_sfx( sfx_name: SFXName, sfx_stream_player := _sfx_stream_player) -> void:
	Logger.info("play_sfx", sfx_name)
	var new_stream := _get_sfx_stream(sfx_name)
	sfx_stream_player.stream = new_stream
	sfx_stream_player.play()


## This function plays a song.
## @param songName The name of the song to play. see [enum TrackName]
## @param time_in The time it takes to fade in.
## @param time_out The time it takes to fade out.
## @returns void
func play_track(track_name: TrackName) -> void:
	Logger.info("play_track", track_name)
	var new_stream := _get_track_stream(track_name)

	if new_stream == music_players[ current_music_player_index ].stream:
		return

	current_music_player_index += 1
	if current_music_player_index > 1:
		current_music_player_index = 0

	var current_player : AudioStreamPlayer = music_players[ current_music_player_index ]
	current_player.stream = new_stream
	play_and_fade_in( current_player )

	var old_player := music_players[ 1 ]
	if current_music_player_index == 1:
		old_player = music_players[ 0 ]
	fade_out_and_stop( old_player )



func play_and_fade_in( player : AudioStreamPlayer ) -> void:
	player.play( 0 )
	var tween : Tween = create_tween()
	tween.tween_property( player, 'volume_db', 0, music_fade_duration )
	pass


func fade_out_and_stop( player : AudioStreamPlayer ) -> void:
	var tween : Tween = create_tween()
	tween.tween_property( player, 'volume_db', -40, music_fade_duration )
	await tween.finished
	player.stop()
	pass


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
