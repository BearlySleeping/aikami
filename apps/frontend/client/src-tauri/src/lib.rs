// apps/frontend/client/src-tauri/src/lib.rs
// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

use std::fs;
use std::path::PathBuf;

use futures_util::StreamExt;
use hex;
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Aikami.", name)
}

/// Subdirectory inside the app data directory holding engine config + model
/// assets. Matches the `$APPDATA/aikami-assets/**` fs capability allow-list.
const ASSETS_SUBDIR: &str = "aikami-assets";
const CONFIG_FILE: &str = "config.json";

/// Resolves `<app_data_dir>/aikami-assets`, creating it if missing.
fn assets_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;
    let dir = base.join(ASSETS_SUBDIR);
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create assets dir: {e}"))?;
    Ok(dir)
}

/// Returns the runtime `config.json` from the app data directory, or `None`
/// when it has not been written yet. C-389 rung 2 of the precedence chain.
#[tauri::command]
fn read_runtime_config(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = assets_dir(&app)?.join(CONFIG_FILE);
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("Cannot read config file: {e}"))
}

/// Downloads a model asset on the Rust side (bypassing webview CSP), verifies
/// its SHA-256 checksum, and writes it into the app data directory. Progress
/// is emitted as `model-download-progress` events. C-389 AC-5.
#[tauri::command]
async fn download_model_file(
    app: tauri::AppHandle,
    url: String,
    checksum: String,
    file_name: String,
) -> Result<(), String> {
    let dir = assets_dir(&app)?;
    let path = dir.join(&file_name);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Cannot create model dir: {e}"))?;
    }

    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("Download failed: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Download failed (HTTP {status})"));
    }
    let total_bytes = response.content_length().unwrap_or(0);

    let mut stream = response.bytes_stream();
    let mut bytes: Vec<u8> = Vec::new();
    let mut hasher = Sha256::new();
    let mut received_bytes: u64 = 0;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download stream error: {e}"))?;
        received_bytes += chunk.len() as u64;
        hasher.update(&chunk);
        bytes.extend_from_slice(&chunk);
        let _ = app.emit(
            "model-download-progress",
            serde_json::json!({
                "file": file_name,
                "receivedBytes": received_bytes,
                "totalBytes": total_bytes,
            }),
        );
    }

    let digest = hasher.finalize();
    let digest_hex = hex::encode(digest);
    if digest_hex != checksum {
        return Err(format!(
            "Checksum mismatch for {file_name}: expected {checksum}, got {digest_hex}"
        ));
    }

    fs::write(&path, bytes).map_err(|e| format!("Cannot write model file: {e}"))?;
    Ok(())
}

/// Reads a previously downloaded model asset back as bytes so the webview can
/// pre-warm its Cache Storage for the worker. C-389 AC-5.
#[tauri::command]
fn read_model_file(app: tauri::AppHandle, file_name: String) -> Result<Vec<u8>, String> {
    let path = assets_dir(&app)?.join(&file_name);
    fs::read(&path).map_err(|e| format!("Cannot read model file {file_name}: {e}"))
}

/// Removes cached model assets from the app data directory (AC-4c delete).
#[tauri::command]
fn delete_model_files(app: tauri::AppHandle, files: Vec<String>) -> Result<(), String> {
    let dir = assets_dir(&app)?;
    for file in files {
        let path = dir.join(&file);
        if path.exists() {
            fs::remove_file(&path).map_err(|e| format!("Cannot remove {file}: {e}"))?;
        }
    }
    Ok(())
}

/// Writes the default engine config on first run (C-389 migration: existing
/// installs keep today's values; the webview bundle itself carries none).
fn write_default_config(app: &tauri::AppHandle) -> Result<(), String> {
    let dir = assets_dir(app)?;
    let path = dir.join(CONFIG_FILE);
    if path.exists() {
        return Ok(());
    }
    let default = serde_json::json!({
        "text": { "url": "http://localhost:11434", "model": "llama3" },
        "image": { "url": "http://localhost:8188", "engine": "auto" },
        "voice": {
            "tts": { "mode": "browser", "url": null },
            "stt": { "url": null }
        },
        "models": { "originUrl": "https://huggingface.co" }
    });
    let pretty = serde_json::to_string_pretty(&default)
        .map_err(|e| format!("Cannot serialize default config: {e}"))?;
    fs::write(&path, pretty).map_err(|e| format!("Cannot write default config: {e}"))?;
    Ok(())
}

/// Parse a `--route <path>` argument from CLI args, if present.
/// Returns `Some(path)` to open at startup, or `None` to load the root.
///
/// Set by `bun preview --tauri` / `bun preview --tauri-dev`.
fn parse_startup_route() -> Option<String> {
    std::env::args()
        .collect::<Vec<_>>()
        .windows(2)
        .find(|w| w[0] == "--route")
        .map(|w| w[1].clone())
}

/// Picks the `aikami://...` deep link out of a CLI arg list, if present.
fn extract_deep_link(args: &[String]) -> Option<String> {
    args.iter().find(|arg| arg.starts_with("aikami://")).cloned()
}

#[derive(Clone, serde::Serialize)]
struct DeepLinkPayload {
    url: String,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    println!("Tauri startup — CLI args: {:?}", &args);

    let startup_route = parse_startup_route();
    println!("Tauri startup — parsed route: {:?}", &startup_route);

    tauri::Builder::default()
        // Must be registered FIRST (Tauri requirement). On Windows/Linux, a
        // deep link launches a *second* OS process with the URL as a CLI
        // arg — this plugin intercepts that in the already-running instance
        // instead of letting a second window open, so we forward the URL to
        // the frontend directly here rather than depending on
        // tauri-plugin-deep-link's `onOpenUrl` JS event, which its own docs
        // say only fires natively on macOS/iOS/Android. See auth_service.
        // svelte.ts's `_awaitDeviceHandoffToken` for the frontend listener
        // (`deep-link-received`) — polling is still the fallback there
        // regardless of whether this fires.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(url) = extract_deep_link(&argv) {
                let _ = app.emit("deep-link-received", DeepLinkPayload { url });
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .setup(move |app| {
            // C-389: write the default runtime config on first run so the
            // webview resolves engine URLs from the app config directory.
            if let Err(e) = write_default_config(app.handle()) {
                println!("Tauri setup — failed to write default config: {e}");
            }

            // Create the main window with the requested route baked into the
            // app URL. `WebviewUrl::App` resolves against `build.devUrl` in dev
            // mode (herdr dev server) and `tauri://localhost/` in production
            // (embedded frontendDist), so one code path covers both.
            let route = startup_route
                .clone()
                .unwrap_or_default()
                .trim_start_matches('/')
                .to_string();
            println!("Tauri setup — creating main window at route '/{}'", route);

            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App(route.into()),
            )
                .title("Aikami")
                .inner_size(1200.0, 800.0)
                .resizable(true)
                .build()
                .expect("failed to build main window");

            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_log::Builder::new().level(
            if cfg!(debug_assertions) {
                log::LevelFilter::Debug
            } else {
                log::LevelFilter::Info
            }
        ).build())
        .invoke_handler(tauri::generate_handler![
            greet,
            read_runtime_config,
            download_model_file,
            read_model_file,
            delete_model_files
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
