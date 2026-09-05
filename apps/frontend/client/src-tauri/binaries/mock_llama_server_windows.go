// apps/frontend/client/src-tauri/binaries/mock_llama_server_windows.go
//go:build ignore

package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
)

func writeJSON(response http.ResponseWriter, payload any) {
	response.Header().Set("Content-Type", "application/json")
	response.Header().Set("Access-Control-Allow-Origin", "*")
	if err := json.NewEncoder(response).Encode(payload); err != nil {
		http.Error(response, err.Error(), http.StatusInternalServerError)
	}
}

func main() {
	host := flag.String("host", "127.0.0.1", "loopback host")
	port := flag.Int("port", 11434, "listen port")
	flag.String("m", "", "model path accepted for llama-server compatibility")
	flag.Parse()

	mux := http.NewServeMux()
	mux.HandleFunc("OPTIONS /", func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Access-Control-Allow-Origin", "*")
		response.Header().Set("Access-Control-Allow-Headers", "content-type")
		response.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		response.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /health", func(response http.ResponseWriter, _ *http.Request) {
		writeJSON(response, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /v1/models", func(response http.ResponseWriter, _ *http.Request) {
		writeJSON(response, map[string]any{
			"object": "list",
			"data":   []map[string]string{{"id": "development-model", "object": "model"}},
		})
	})
	mux.HandleFunc("POST /v1/chat/completions", func(response http.ResponseWriter, _ *http.Request) {
		writeJSON(response, map[string]any{
			"id":     "dev",
			"object": "chat.completion",
			"choices": []map[string]any{{
				"index":         0,
				"message":       map[string]string{"role": "assistant", "content": "Development sidecar response"},
				"finish_reason": "stop",
			}},
		})
	})

	if err := http.ListenAndServe(fmt.Sprintf("%s:%d", *host, *port), mux); err != nil {
		panic(err)
	}
}
