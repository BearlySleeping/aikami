#!/usr/bin/env bash
# Development-only OpenAI-compatible llama-server stand-in for WSL.
exec python3 - "$@" <<'PY'
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

arguments = sys.argv[1:]
port = int(arguments[arguments.index("--port") + 1]) if "--port" in arguments else 11434
host = arguments[arguments.index("--host") + 1] if "--host" in arguments else "127.0.0.1"

class Handler(BaseHTTPRequestHandler):
    def send_json(self, payload):
        body = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self.send_json({"status": "ok"})
        elif self.path == "/v1/models":
            self.send_json({"object": "list", "data": [{"id": "development-model", "object": "model"}]})
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path == "/v1/chat/completions":
            self.send_json({"id": "dev", "object": "chat.completion", "choices": [{"index": 0, "message": {"role": "assistant", "content": "Development sidecar response"}, "finish_reason": "stop"}]})
        else:
            self.send_error(404)

    def log_message(self, *_):
        pass

ThreadingHTTPServer((host, port), Handler).serve_forever()
PY
