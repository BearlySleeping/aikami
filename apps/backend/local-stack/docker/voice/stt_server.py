#!/usr/bin/env python3
"""C-393 STT service — streaming websocket + capabilities + health + batch proxy.

One stdlib-only Python process on the STT port (8087) inside the sherpa
voice container (docker/voice/entrypoint.sh), serving:

  GET  /health                 readiness — 503 with the missing model file
                               named when models are absent (AC-10)
  GET  /v1/capabilities        introspection (AC-4)
  WS   /v1/stream              streaming protocol (AC-1/AC-2/AC-5/AC-6/AC-9)
  POST /v1/audio/transcriptions  OpenAI-compatible batch, proxied to the
                               whisper.cpp whisper-server on an internal
                               port (AC-3)

Wire contract (shared schemas in packages/shared/schemas/src/lib/local_ai/
stt.ts — the service emits exactly those JSON shapes):

  Client → server (text frames): {"type":"start","protocolVersion":1,"language"?}
                                 {"type":"stop"}
  Client → server (binary frames): raw 16 kHz mono 16-bit PCM (pcm_s16le)
  Server → client (text frames): ready | speech-start | partial | final |
                                 speech-end | error

Audio is 16 kHz mono 16-bit PCM only (AC-6). VAD runs server-side with Silero
(AC-2) and the client never infers endpointing. Transcript text is NEVER
logged (AC-8): logs cover connection lifecycle, model load, language, and
decode duration only. No audio is ever written to disk.

Env:
  STT_BIND_ADDRESS  bind address (default 127.0.0.1; the container overrides
                    to 0.0.0.0 so the compose network can reach it)
  STT_STREAM_MODEL  streaming model dir under MODELS_DIR (targetPath from
                    models.manifest.json, default stt/sherpa-onnx-moonshine-tiny-en-int8)
  STT_BATCH_MODEL   batch model file under MODELS_DIR (default stt/whisper-tiny/ggml-tiny.bin)
  STT_VAD_MODEL     Silero VAD model file (default stt/silero_vad.onnx)
  STT_STREAM_ENGINE engine selector, seam for licensed providers (default moonshine)
  STT_BATCH_ENGINE  engine selector (default whisper-cpp)
  STT_ALLOWED_ORIGINS  comma-separated Origin allowlist for WS (AC-9); an
                       absent Origin is always allowed (native/Tauri clients)
  STT_VAD_THRESHOLD / STT_VAD_MIN_SPEECH_MS / STT_VAD_MIN_SILENCE_MS /
  STT_VAD_MAX_SPEECH_MS  Silero VAD tuning knobs (see README)
  STT_MAX_SESSIONS   concurrent streaming sessions (default 1; beyond that
                     a client gets error: overloaded)
  STT_PARTIAL_INTERVAL_MS  minimum new-audio between partial decodes (default 300)
  STT_IDLE_TIMEOUT_MS  socket idle timeout (default 30000)
  WHISPER_PORT       internal port of the whisper.cpp whisper-server (default 8091)
"""
import base64
import hashlib
import json
import os
import socket
import struct
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# ── Constants ─────────────────────────────────────────────────────────────
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
SAMPLE_RATE = 16000
BYTES_PER_SECOND = SAMPLE_RATE * 2  # 16-bit mono

# whisper.cpp's language list (~99 languages, ISO 639-1 codes). Moonshine is
# English-only (AC-5); the batch engine covers the rest.
WHISPER_LANGUAGES = [
    "en", "zh", "de", "es", "ru", "ko", "fr", "ja", "pt", "tr", "pl", "ca",
    "nl", "ar", "sv", "it", "id", "hi", "fi", "vi", "he", "uk", "el", "ms",
    "cs", "ro", "da", "hu", "ta", "no", "th", "ur", "hr", "bg", "lt", "la",
    "mi", "ml", "cy", "sk", "te", "fa", "lv", "bn", "sr", "az", "sl", "kn",
    "et", "mk", "br", "eu", "is", "hy", "ne", "mn", "bs", "kk", "sq", "sw",
    "gl", "mr", "pa", "si", "km", "sn", "yo", "so", "af", "oc", "ka", "be",
    "tg", "sd", "gu", "am", "yi", "lo", "uz", "fo", "ht", "ps", "tk", "nn",
    "mt", "sa", "lb", "my", "bo", "tl", "mg", "as", "tt", "haw", "ln", "ha",
    "ba", "jw", "su",
]

DEFAULT_STREAM_MODEL = "stt/sherpa-onnx-moonshine-tiny-en-int8"
DEFAULT_BATCH_MODEL = "stt/whisper-tiny/ggml-tiny.bin"
DEFAULT_VAD_MODEL = "stt/silero_vad.onnx"


def _env_str(name: str, default: str) -> str:
    """Read a string env var with a default."""
    return os.environ.get(name, default)


def _env_int(name: str, default: int) -> int:
    """Read an int env var with a default; invalid values fall back."""
    try:
        return int(os.environ.get(name, str(default)))
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    """Read a float env var with a default; invalid values fall back."""
    try:
        return float(os.environ.get(name, str(default)))
    except ValueError:
        return default


def _now_ms() -> int:
    """Wall-clock milliseconds (epoch)."""
    return int(time.time() * 1000)


# ── Minimal RFC6455 websocket (server side) ───────────────────────────────
class WebSocket:
    """A server-side websocket connection over a raw socket.

    Handles handshake (performed by the HTTP handler), frame parsing with
    client-mask unmasking, fragmentation, and ping/pong/close. Server frames
    are never masked. Stdlib-only per the container convention.
    """

    def __init__(self, rfile, wfile):
        self._rfile = rfile
        self._wfile = wfile

    @staticmethod
    def accept_key(key: str) -> str:
        """RFC6455 Sec-WebSocket-Accept for a client key."""
        digest = hashlib.sha1((key + WS_GUID).encode("ascii")).digest()
        return base64.b64encode(digest).decode("ascii")

    def _read_exact(self, n: int) -> bytes:
        """Read exactly n bytes from the buffered stream."""
        chunks = []
        remaining = n
        while remaining > 0:
            chunk = self._rfile.read(remaining)
            if not chunk:
                raise ConnectionError("websocket stream closed")
            chunks.append(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)

    def read_frame(self):
        """Read one frame. Returns (fin, opcode, payload) or None on close."""
        try:
            header = self._read_exact(2)
        except (ConnectionError, OSError):
            return None
        b0, b1 = header[0], header[1]
        fin = bool(b0 & 0x80)
        opcode = b0 & 0x0F
        masked = bool(b1 & 0x80)
        length = b1 & 0x7F
        if length == 126:
            length = struct.unpack(">H", self._read_exact(2))[0]
        elif length == 127:
            length = struct.unpack(">Q", self._read_exact(8))[0]
        if length > 4 * 1024 * 1024:
            raise ValueError("websocket frame too large")
        mask_key = self._read_exact(4) if masked else None
        payload = self._read_exact(length) if length else b""
        if masked:
            payload = bytes(byte ^ mask_key[i % 4] for i, byte in enumerate(payload))
        return fin, opcode, payload

    def send_frame(self, opcode: int, payload: bytes) -> None:
        """Send one unmasked server frame."""
        header = bytearray([0x80 | opcode])
        length = len(payload)
        if length < 126:
            header.append(length)
        elif length < 65536:
            header.append(126)
            header.extend(struct.pack(">H", length))
        else:
            header.append(127)
            header.extend(struct.pack(">Q", length))
        self._wfile.write(bytes(header) + payload)
        self._wfile.flush()

    def send_text(self, text: str) -> None:
        """Send a text frame."""
        self.send_frame(0x1, text.encode("utf-8"))

    def send_binary(self, data: bytes) -> None:
        """Send a binary frame."""
        self.send_frame(0x2, data)

    def send_close(self, code: int = 1000, reason: str = "") -> None:
        """Send a close frame."""
        payload = struct.pack(">H", code) + reason.encode("utf-8")
        try:
            self.send_frame(0x8, payload)
        except (OSError, BrokenPipeError):
            pass

    def read_message(self):
        """Read one complete message, handling fragmentation + control frames.

        Returns (opcode, payload) or None when the peer closed.
        """
        opcode = None
        data = b""
        while True:
            try:
                frame = self.read_frame()
            except (ValueError, ConnectionError, OSError):
                return None
            if frame is None:
                return None
            fin, op, payload = frame
            if op == 0x8:  # close
                self.send_close(1000)
                return None
            if op == 0x9:  # ping → pong
                self.send_frame(0xA, payload)
                continue
            if op == 0xA:  # pong
                continue
            if op == 0x0:  # continuation
                if opcode is None:
                    return None
                data += payload
                if fin:
                    return opcode, data
            elif op in (0x1, 0x2):
                opcode = op
                data = payload
                if fin:
                    return opcode, data
            else:
                return None


# ── VAD + incremental decode pipeline ─────────────────────────────────────
class VadPipeline:
    """Feeds PCM to Silero VAD and emits speech events + partials/final.

    The sherpa-onnx VoiceActivityDetector exposes completed segments via
    front()/pop(); in-progress speech is tracked with our own sample buffer
    so partial hypotheses can be produced while the user is still talking.
    """

    def __init__(self, detector, recognizer, on_event, partial_interval_samples: int, decode_lock):
        self._detector = detector
        self._recognizer = recognizer
        self._on_event = on_event
        self._partial_interval = partial_interval_samples
        self._decode_lock = decode_lock
        self._speech = False
        self._buffer: list[float] = []
        self._speech_start_ms = 0
        self._last_decode_ms = 0
        self._ever_finalized = False

    def accept(self, samples: list[float]) -> None:
        """Accept a chunk of 16 kHz mono float samples from the wire."""
        was_speech = self._speech
        self._detector.accept_waveform(samples)
        now_speech = self._detector.is_speech_detected()
        if not was_speech and now_speech:
            self._speech = True
            self._speech_start_ms = _now_ms()
            self._on_event({"type": "speech-start", "atMs": self._speech_start_ms})
        if now_speech:
            self._buffer.extend(samples)
            self._maybe_partial()
        # Completed utterances (VAD detected silence long enough).
        while not self._detector.empty():
            segment = self._detector.front
            self._detector.pop()
            self._finalize(segment)

    def _decode(self, samples: list[float]) -> str:
        """Run the offline recognizer over the given samples (thread-safe).

        sherpa-onnx 1.13 Python binding: decode_stream() returns None, but
        the decoded text is available on the stream's `result` attribute
        (verified against the shipped wheel).
        """
        if not samples:
            return ""
        started = _now_ms()
        with self._decode_lock:
            stream = self._recognizer.create_stream()
            stream.accept_waveform(SAMPLE_RATE, samples)
            self._recognizer.decode_stream(stream)
            text = stream.result.text
        elapsed = _now_ms() - started
        print(f"[stt] decode {len(samples) / SAMPLE_RATE:.2f}s audio in {elapsed}ms", flush=True)
        return text.strip()

    def _maybe_partial(self) -> None:
        """Emit a partial when enough NEW audio has accumulated since last."""
        now = _now_ms()
        if now - self._last_decode_ms < 150:
            return
        if len(self._buffer) - self._last_partial_len() < self._partial_interval:
            return
        self._last_decode_ms = now
        self._last_partial_len_marker = len(self._buffer)
        text = self._decode(self._buffer)
        if text:
            self._on_event({"type": "partial", "text": text, "atMs": _now_ms()})

    def _last_partial_len(self) -> int:
        return getattr(self, "_last_partial_len_marker", 0)

    def _finalize(self, segment) -> None:
        """Emit the final transcript for a completed VAD segment."""
        samples = list(segment.samples) if hasattr(segment, "samples") else list(self._buffer)
        # sherpa-onnx SpeechSegment.start is the START SAMPLE INDEX at 16 kHz
        # (verified against the 1.13.4 wheel) — convert to ms.
        start_ms = int(getattr(segment, "start", 0) / SAMPLE_RATE * 1000)
        text = self._decode(samples)
        end_ms = _now_ms()
        self._on_event({"type": "final", "text": text, "startMs": start_ms, "endMs": end_ms})
        self._on_event({"type": "speech-end", "atMs": end_ms})
        self._speech = False
        self._buffer = []
        self._last_partial_len_marker = 0
        self._ever_finalized = True

    def flush(self) -> None:
        """Finalize the in-progress utterance on client `stop` (AC-1).

        Exactly one final per session: an in-progress utterance is decoded;
        a session that never produced speech gets a single empty final
        (silence-only input, Edge Cases). A session whose utterance was
        already finalized by VAD emits nothing further.
        """
        if self._speech or self._buffer:
            start_ms = self._speech_start_ms or _now_ms()
            text = self._decode(self._buffer)
            end_ms = _now_ms()
            self._on_event({"type": "final", "text": text, "startMs": start_ms, "endMs": end_ms})
            self._on_event({"type": "speech-end", "atMs": end_ms})
            self._speech = False
            self._buffer = []
            self._last_partial_len_marker = 0
            self._ever_finalized = True
        elif not self._ever_finalized:
            # Silence-only input: an empty final, never an error (Edge Cases).
            now = _now_ms()
            self._on_event({"type": "final", "text": "", "startMs": now, "endMs": now})
            self._ever_finalized = True


# ── Model loading ─────────────────────────────────────────────────────────
class SttModels:
    """Loads and exposes the streaming recognizer + VAD + batch model paths.

    A missing model must not crash the server — /health reports the exact
    missing file (AC-10) and streaming sessions get `model-not-loaded`.
    """

    def __init__(self, models_dir: str):
        self.models_dir = models_dir
        self.stream_model = _env_str("STT_STREAM_MODEL", DEFAULT_STREAM_MODEL)
        self.batch_model = _env_str("STT_BATCH_MODEL", DEFAULT_BATCH_MODEL)
        self.vad_model = _env_str("STT_VAD_MODEL", DEFAULT_VAD_MODEL)
        self.stream_engine = _env_str("STT_STREAM_ENGINE", "moonshine")
        self.batch_engine = _env_str("STT_BATCH_ENGINE", "whisper-cpp")
        self.recognizer = None
        self.vad = None
        self.missing: list[str] = []
        self._load()

    def _path(self, rel: str) -> str:
        """Resolve a manifest targetPath under the models dir."""
        return str(Path(self.models_dir) / rel)

    def stream_dir(self) -> str:
        """Directory containing the streaming model files."""
        return self._path(self.stream_model)

    def _load(self) -> None:
        """Attempt to load the streaming recognizer and the VAD."""
        if self.stream_engine != "moonshine":
            self.missing.append(f"streaming engine '{self.stream_engine}' is not available")
            print(f"[stt] unsupported STT_STREAM_ENGINE={self.stream_engine}", flush=True)
            return
        import sherpa_onnx  # deferred so /health still works without the wheel

        model_dir = self.stream_dir()
        required = {
            "preprocess.onnx": Path(model_dir, "preprocess.onnx"),
            "encode.int8.onnx": Path(model_dir, "encode.int8.onnx"),
            "uncached_decode.int8.onnx": Path(model_dir, "uncached_decode.int8.onnx"),
            "cached_decode.int8.onnx": Path(model_dir, "cached_decode.int8.onnx"),
            "tokens.txt": Path(model_dir, "tokens.txt"),
        }
        missing_model = [str(p) for p in required.values() if not p.exists()]
        if missing_model:
            self.missing.extend(missing_model)
            print(f"[stt] streaming model missing: {missing_model}", flush=True)
            return
        vad_path = self._path(self.vad_model)
        if not Path(vad_path).exists():
            self.missing.append(vad_path)
            print(f"[stt] VAD model missing: {vad_path}", flush=True)
            return

        try:
            # sherpa-onnx 1.13 Python API: Moonshine has a dedicated
            # constructor (verified against the shipped wheel).
            self.recognizer = sherpa_onnx.OfflineRecognizer.from_moonshine(
                preprocessor=str(required["preprocess.onnx"]),
                encoder=str(required["encode.int8.onnx"]),
                uncached_decoder=str(required["uncached_decode.int8.onnx"]),
                cached_decoder=str(required["cached_decode.int8.onnx"]),
                tokens=str(required["tokens.txt"]),
                num_threads=_env_int("STT_NUM_THREADS", 2),
                decoding_method="greedy_search",
            )
        except Exception as exc:  # noqa: BLE001 — surface the load failure
            self.missing.append(model_dir)
            print(f"[stt] recognizer load failed: {exc}", flush=True)
            return

        try:
            vad_config = sherpa_onnx.VadModelConfig()
            vad_config.sample_rate = SAMPLE_RATE
            vad_config.silero_vad.model = vad_path
            vad_config.silero_vad.threshold = _env_float("STT_VAD_THRESHOLD", 0.5)
            vad_config.silero_vad.min_silence_duration = _env_int(
                "STT_VAD_MIN_SILENCE_MS", 500
            ) / 1000.0
            vad_config.silero_vad.min_speech_duration = _env_int(
                "STT_VAD_MIN_SPEECH_MS", 250
            ) / 1000.0
            vad_config.silero_vad.max_speech_duration = _env_int(
                "STT_VAD_MAX_SPEECH_MS", 30000
            ) / 1000.0
            # 0.5 s internal ring buffer — avoids the circular-buffer overflow
            # churn seen with smaller buffers on 1600-sample chunks.
            self.vad = sherpa_onnx.VoiceActivityDetector(vad_config, 0.5)
        except Exception as exc:  # noqa: BLE001
            self.missing.append(vad_path)
            print(f"[stt] VAD load failed: {exc}", flush=True)

        if self.recognizer is not None and self.vad is not None:
            print(f"[stt] Moonshine model loaded from {model_dir}", flush=True)
            print(f"[stt] VAD loaded from {vad_path}", flush=True)

    def batch_available(self) -> bool:
        """The batch model file exists (the whisper server is supervised by entrypoint)."""
        return Path(self._path(self.batch_model)).exists()

    def batch_model_name(self) -> str:
        return Path(self.batch_model).name

    def stream_model_name(self) -> str:
        return Path(self.stream_model).name

    def capabilities(self) -> dict:
        """The GET /v1/capabilities document (AC-4)."""
        return {
            "streaming": {
                "available": self.recognizer is not None and self.vad is not None,
                "engine": self.stream_engine,
                "model": self.stream_model_name(),
                "languages": ["en"],
                "vad": True,
                "wordTimestamps": False,
            },
            "batch": {
                "available": self.batch_available(),
                "engine": self.batch_engine,
                "model": self.batch_model_name(),
                "languages": list(WHISPER_LANGUAGES),
            },
            "audio": {"sampleRate": SAMPLE_RATE, "channels": 1, "encoding": "pcm_s16le"},
            "protocolVersion": 1,
        }

    def health(self) -> tuple[int, dict]:
        """(status_code, body) for GET /health (AC-10)."""
        if not self.missing and self.recognizer is not None and self.vad is not None:
            return 200, {"status": "ok"}
        missing = list(self.missing)
        if not self.batch_available():
            missing.append(self._path(self.batch_model))
        return 503, {"status": "unhealthy", "missing": missing}


# ── HTTP + websocket handler ──────────────────────────────────────────────
class SttHandler(BaseHTTPRequestHandler):
    """Threaded handler: HTTP endpoints + raw websocket upgrade for /v1/stream."""

    server_version = "aikami-stt/1"

    def log_message(self, *args):  # keep container logs quiet (AC-8: no transcripts)
        pass

    # ── helpers ──
    def _send_json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_text(self, code: int, text: str, ctype: str = "text/plain") -> None:
        body = text.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # ── routes ──
    def do_GET(self):  # noqa: N802 — http.server API
        if self.path == "/health":
            code, body = self.server.models.health()  # type: ignore[attr-defined]
            self._send_json(code, body)
            return
        if self.path == "/v1/capabilities":
            self._send_json(200, self.server.models.capabilities())  # type: ignore[attr-defined]
            return
        if self.path == "/v1/stream":
            self._handle_websocket()
            return
        self._send_text(404, "not found")

    def do_POST(self):  # noqa: N802 — http.server API
        if self.path == "/v1/audio/transcriptions":
            self._proxy_batch()
            return
        self._send_text(404, "not found")

    # ── websocket (AC-1/AC-2/AC-5/AC-6/AC-9) ──
    def _handle_websocket(self) -> None:
        # AC-9: reject cross-origin connections before any audio is accepted.
        # An absent Origin is deliberately allowed — Tauri webviews and
        # non-browser callers may send none at all.
        origin = self.headers.get("Origin")
        allowed = self.server.allowed_origins  # type: ignore[attr-defined]
        if origin and origin not in allowed:
            print(f"[stt] rejected websocket origin: {origin}", flush=True)
            self._send_text(403, "origin not allowed")
            return
        key = self.headers.get("Sec-WebSocket-Key", "")
        if not key:
            self._send_text(400, "missing Sec-WebSocket-Key")
            return
        try:
            self.wfile.write(b"HTTP/1.1 101 Switching Protocols\r\n")
            self.wfile.write(b"Upgrade: websocket\r\n")
            self.wfile.write(b"Connection: Upgrade\r\n")
            self.wfile.write(f"Sec-WebSocket-Accept: {WebSocket.accept_key(key)}\r\n".encode())
            self.wfile.write(b"\r\n")
            self.wfile.flush()
        except OSError:
            return
        self._run_stream_session(WebSocket(self.rfile, self.wfile))

    def _run_stream_session(self, ws: WebSocket) -> None:
        """The WS /v1/stream session loop (AC-1)."""
        models: SttModels = self.server.models  # type: ignore[attr-defined]
        sessions = self.server.active_sessions  # type: ignore[attr-defined]
        max_sessions = self.server.max_sessions  # type: ignore[attr-defined]
        session_start = _now_ms()

        if not sessions.acquire(blocking=False):
            print("[stt] session rejected: overloaded", flush=True)
            ws.send_text(json.dumps({"type": "error", "code": "overloaded", "message": "server busy"}))
            ws.send_close(1013)
            return

        try:
            idle_timeout = self.server.idle_timeout_ms / 1000.0  # type: ignore[attr-defined]
            self.connection.settimeout(idle_timeout)
            first = ws.read_message()
            if first is None:
                return
            opcode, payload = first
            if opcode != 0x1:
                ws.send_text(
                    json.dumps(
                        {"type": "error", "code": "internal", "message": "first message must be a JSON start"}
                    )
                )
                ws.send_close(1002)
                return
            try:
                start_msg = json.loads(payload.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                ws.send_text(
                    json.dumps({"type": "error", "code": "internal", "message": "invalid JSON start"})
                )
                ws.send_close(1002)
                return

            if start_msg.get("type") != "start":
                ws.send_text(
                    json.dumps({"type": "error", "code": "internal", "message": "expected a start message"})
                )
                ws.send_close(1002)
                return
            if start_msg.get("protocolVersion") != 1:
                ws.send_text(
                    json.dumps(
                        {
                            "type": "error",
                            "code": "protocol-version-mismatch",
                            "message": f"unsupported protocolVersion {start_msg.get('protocolVersion')}",
                        }
                    )
                )
                ws.send_close(1002)
                return

            # AC-5: Moonshine is English-only — report, never mis-transcribe.
            language = start_msg.get("language")
            if language and language.lower() not in ("en", "english"):
                ws.send_text(
                    json.dumps(
                        {
                            "type": "error",
                            "code": "unsupported-language",
                            "message": (
                                f"language '{language}' is not supported by the streaming engine; "
                                "use POST /v1/audio/transcriptions (whisper.cpp) for multilingual audio"
                            ),
                        }
                    )
                )
                ws.send_close(1002)
                return

            if models.recognizer is None or models.vad is None:
                ws.send_text(
                    json.dumps(
                        {
                            "type": "error",
                            "code": "model-not-loaded",
                            "message": f"model not loaded; missing: {models.missing}",
                        }
                    )
                )
                ws.send_close(1011)
                return

            # Session accepted.
            ws.send_text(
                json.dumps({"type": "ready", "capabilities": models.capabilities()})
            )
            print(
                f"[stt] session start language={language or 'en'} "
                f"(after {_now_ms() - session_start}ms)",
                flush=True,
            )

            pipeline = VadPipeline(
                detector=models.vad,
                recognizer=models.recognizer,
                on_event=lambda event: ws.send_text(json.dumps(event)),
                partial_interval_samples=max(
                    1, int(self.server.partial_interval_ms * SAMPLE_RATE / 1000.0)
                ),
                decode_lock=self.server.decode_lock,  # type: ignore[attr-defined]
            )

            # AC-6: validate the audio format on the fly (16k mono s16le).
            audio_start = 0
            bytes_received = 0

            while True:
                message = ws.read_message()
                if message is None:
                    # Client closed — cancel and free buffers immediately.
                    print("[stt] session closed by client", flush=True)
                    return
                op, payload = message
                if op == 0x1:
                    try:
                        control = json.loads(payload.decode("utf-8"))
                    except (ValueError, UnicodeDecodeError):
                        continue
                    if control.get("type") == "stop":
                        pipeline.flush()
                        ws.send_close(1000)
                        print(
                            f"[stt] session end after {_now_ms() - session_start}ms",
                            flush=True,
                        )
                        return
                    continue
                if op != 0x2 or len(payload) == 0:
                    continue
                if len(payload) % 2 != 0:
                    self._stream_error(ws, "bad-audio-format", "expected 16 kHz mono 16-bit PCM (even byte frames)")
                    return

                now = _now_ms()
                if audio_start == 0:
                    audio_start = now
                bytes_received += len(payload)
                # Sample-rate plausibility over the audio clock (AC-6): a
                # stream that delivers far more (or far less) than 32000
                # bytes per second is not 16 kHz mono 16-bit PCM. The floor
                # lets a real-time client burst a few hundred ms before
                # judging; the ±30% window tolerates network jitter while
                # still rejecting e.g. 44.1k stereo (~5.5× the rate).
                elapsed = (now - audio_start) / 1000.0
                if elapsed >= 0.5:
                    expected_min = BYTES_PER_SECOND * elapsed * 0.7
                    expected_max = BYTES_PER_SECOND * elapsed * 1.3
                    if bytes_received < expected_min or bytes_received > expected_max:
                        self._stream_error(
                            ws,
                            "bad-audio-format",
                            (
                                f"expected 16 kHz mono 16-bit PCM "
                                f"(32000 bytes/sec), measured ~{int(bytes_received / elapsed)} bytes/sec"
                            ),
                        )
                        return

                samples = [
                    struct.unpack_from("<h", payload, i)[0] / 32768.0
                    for i in range(0, len(payload), 2)
                ]
                pipeline.accept(samples)

        except (ConnectionError, OSError, TimeoutError):
            print(f"[stt] session dropped after {_now_ms() - session_start}ms", flush=True)
        finally:
            sessions.release()
            try:
                self.connection.settimeout(None)
            except OSError:
                pass

    def _stream_error(self, ws: WebSocket, code: str, message: str) -> None:
        """Send an error frame and close (AC-5/AC-6)."""
        ws.send_text(json.dumps({"type": "error", "code": code, "message": message}))
        ws.send_close(1002)

    # ── batch proxy (AC-3) ──
    def _proxy_batch(self) -> None:
        """Forward POST /v1/audio/transcriptions to the internal whisper server."""
        models: SttModels = self.server.models  # type: ignore[attr-defined]
        whisper_port = self.server.whisper_port  # type: ignore[attr-defined]
        if models.batch_engine != "whisper-cpp" or not models.batch_available():
            self._send_json(
                503,
                {
                    "error": {
                        "message": f"batch model not available: {models._path(models.batch_model)}"
                    }
                },
            )
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            length = 0
        body = self.rfile.read(length) if length > 0 else b""
        # whisper.cpp's server exposes the multipart endpoint at /inference;
        # its JSON response ({'text': ...}) is OpenAI-shaped, so a path
        # rewrite is the whole translation (AC-3).
        upstream = f"http://127.0.0.1:{whisper_port}/inference"
        request = urllib.request.Request(upstream, data=body, method="POST")
        for header in ("Content-Type", "Accept", "Authorization"):
            value = self.headers.get(header)
            if value:
                request.add_header(header, value)
        try:
            with urllib.request.urlopen(request, timeout=300) as response:  # noqa: S310 — local only
                data = response.read()
                self.send_response(response.status)
                self.send_header(
                    "Content-Type", response.headers.get("Content-Type", "application/json")
                )
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                print(f"[stt] batch transcription ok ({len(data)} bytes)", flush=True)
        except urllib.error.HTTPError as error:
            data = error.read()
            self.send_response(error.code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as exc:  # noqa: BLE001
            self._send_json(502, {"error": {"message": f"batch backend unavailable: {exc}"}})


# ── Server ────────────────────────────────────────────────────────────────
class SttServer(ThreadingHTTPServer):
    """Threaded HTTP/WS server carrying shared STT state."""

    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, handler, models: SttModels):
        super().__init__(address, handler)
        self.models = models
        self.allowed_origins = {
            origin.strip()
            for origin in _env_str(
                "STT_ALLOWED_ORIGINS",
                "http://localhost:5274,http://127.0.0.1:5274,"
                "tauri://localhost,http://tauri.localhost,https://tauri.localhost",
            ).split(",")
            if origin.strip()
        }
        self.max_sessions = max(1, _env_int("STT_MAX_SESSIONS", 1))
        self.partial_interval_ms = _env_int("STT_PARTIAL_INTERVAL_MS", 300)
        self.idle_timeout_ms = _env_int("STT_IDLE_TIMEOUT_MS", 30000)
        self.whisper_port = _env_int("WHISPER_PORT", 8091)
        self.active_sessions = threading.Semaphore(self.max_sessions)
        self.decode_lock = threading.Lock()


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8087
    bind = _env_str("STT_BIND_ADDRESS", "127.0.0.1")
    models_dir = _env_str("MODELS_DIR", "/models")
    models = SttModels(models_dir)
    server = SttServer((bind, port), SttHandler, models)
    print(f"[stt] listening on {bind}:{port}", flush=True)
    print(f"[stt] streaming engine={models.stream_engine} model={models.stream_model}", flush=True)
    print(f"[stt] batch engine={models.batch_engine} model={models.batch_model}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
