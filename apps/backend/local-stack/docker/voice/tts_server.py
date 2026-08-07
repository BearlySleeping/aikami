#!/usr/bin/env python3
"""OpenAI-compatible /v1/audio/speech server backed by sherpa-onnx Kokoro TTS.

Serves the endpoint the Aikami client calls (PUBLIC_VOICE_URL + /v1/audio/speech)
with the OpenAI speech request shape: {"input": str, "voice": str, "speed": float}.

Uses only the Python standard library on top of sherpa-onnx — no extra deps.
Usage: python3 tts_server.py [port]
"""
import array
import io
import json
import os
import sys
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import sherpa_onnx

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 6006
# Container layout by default; override with KOKORO_DIR for host runs.
MODEL_DIR = Path(os.environ.get("KOKORO_DIR", "/models/tts/kokoro-multi-lang-v1_0"))

# Kokoro speaker name -> sid (0-10), matching the sherpa-onnx tarball layout
KOKORO_VOICES = [
    "af", "af_bella", "af_nicole", "af_sarah", "af_sky",
    "am_adam", "am_michael", "bf_emma", "bf_isabella", "bm_george", "bm_lewis",
]


def resolve_sid(voice):
    """Map an OpenAI-style voice name (or bare int) to a Kokoro speaker id."""
    if isinstance(voice, int):
        return voice
    if isinstance(voice, str):
        try:
            return KOKORO_VOICES.index(voice)
        except ValueError:
            try:
                return int(voice)
            except ValueError:
                pass
    return 0


def load_tts():
    config = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                model=str(MODEL_DIR / "model.onnx"),
                voices=str(MODEL_DIR / "voices.bin"),
                tokens=str(MODEL_DIR / "tokens.txt"),
                data_dir=str(MODEL_DIR / "espeak-ng-data"),
                # Multilingual Kokoro (>= v1.0) requires the lexicons for its
                # frontend — comma-separated paths, mirroring the sherpa-onnx
                # CLI --kokoro-lexicon convention.
                lexicon=",".join(
                    str(MODEL_DIR / f) for f in ("lexicon-us-en.txt", "lexicon-zh.txt")
                ),
            ),
            num_threads=2,
        ),
    )
    if not config.validate():
        raise SystemExit("Invalid sherpa-onnx TTS config")
    return sherpa_onnx.OfflineTts(config)


class TTSHandler(BaseHTTPRequestHandler):
    tts = None

    def log_message(self, *args):  # keep container logs quiet
        pass

    def _send(self, code, body=b"", ctype="application/octet-stream"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send(200, b"ok", "text/plain")
        else:
            self._send(404, b"not found", "text/plain")

    def do_POST(self):
        if self.path != "/v1/audio/speech":
            self._send(404, b"not found", "text/plain")
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            self._send(400, b"invalid json", "text/plain")
            return

        text = str(body.get("input", ""))
        if not text.strip():
            self._send(400, b"missing 'input'", "text/plain")
            return
        sid = resolve_sid(body.get("voice"))
        speed = float(body.get("speed", 1.0))

        gen = sherpa_onnx.GenerationConfig()
        gen.sid = sid
        gen.speed = speed
        audio = self.tts.generate(text, gen)
        if len(audio.samples) == 0:
            self._send(500, b"tts generation failed", "text/plain")
            return

        # Pack float samples to 16-bit PCM mono WAV
        pcm = array.array("h", (int(max(-32768, min(32767, s * 32767))) for s in audio.samples))
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(audio.sample_rate)
            wav.writeframes(pcm.tobytes())
        self._send(200, buf.getvalue(), "audio/wav")


def main():
    print(f"[tts] Loading Kokoro model from {MODEL_DIR} ...", flush=True)
    TTSHandler.tts = load_tts()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), TTSHandler)
    print(f"[tts] OpenAI-compatible /v1/audio/speech on :{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
