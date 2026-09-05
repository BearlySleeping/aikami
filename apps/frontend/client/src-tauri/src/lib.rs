// apps/frontend/client/src-tauri/src/lib.rs
// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
//
// C-467: Tauri ProbeExecutor adapter — probe_run, probe_read_text_file,
// probe_statfs commands that the planning core's ProbeExecutor seam
// calls through Tauri IPC instead of process.execPath.
// Also: sidecar lifecycle management via tauri-plugin-shell.

use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;

use futures_util::StreamExt;
use hex;
use reqwest::Url;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;


#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Aikami.", name)
}

// ── C-467: ProbeExecutor adapter commands ───────────────────────────────

/// Discriminated probe result returned to the JS side.
#[derive(Serialize)]
struct ProbeResultPayload {
    ok: bool,
    stdout: String,
    stderr: String,
    exit_code: i32,
    /// Present when ok=false; one of 'not-found', 'timeout', 'denied', 'failed'.
    reason: Option<String>,
    /// Optional detail string for failure reasons.
    detail: Option<String>,
}

/// Runs a command with a timeout, matching the ProbeExecutor.run() contract.
/// Returns raw stdout/stderr/exit_code — never builds or evaluates a shell
/// string (C-467 Architecture Directives: security boundary).
#[tauri::command]
async fn probe_run(command: String, args: Vec<String>, timeout_ms: u64) -> ProbeResultPayload {
    let result = run_probe_inner(&command, &args, timeout_ms).await;
    match result {
        Ok(output) => {
            let stderr_str = String::from_utf8_lossy(&output.stderr).to_string();
            let stdout_str = String::from_utf8_lossy(&output.stdout).to_string();
            if output.status.success() {
                ProbeResultPayload {
                    ok: true,
                    stdout: stdout_str,
                    stderr: stderr_str,
                    exit_code: output.status.code().unwrap_or(0),
                    reason: None,
                    detail: None,
                }
            } else {
                ProbeResultPayload {
                    ok: false,
                    stdout: stdout_str,
                    stderr: stderr_str,
                    exit_code: output.status.code().unwrap_or(1),
                    reason: Some("failed".to_string()),
                    detail: Some(format!("exit code {}", output.status.code().unwrap_or(1))),
                }
            }
        }
        Err(e) => ProbeResultPayload {
            ok: false,
            stdout: String::new(),
            stderr: String::new(),
            exit_code: -1,
            reason: Some(e.kind),
            detail: Some(e.message),
        },
    }
}

#[derive(Debug)]
struct ProbeError {
    kind: String,
    message: String,
}

/// Runs a command with a timeout, returning std::process::Output on success
/// or ProbeError on failure (not-found, timeout, or other).
async fn run_probe_inner(
    command: &str,
    args: &[String],
    timeout_ms: u64,
) -> Result<std::process::Output, ProbeError> {
    use std::time::Duration;
    use tokio::process::Command;

    let Ok(cmd) = Command::new(command)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
    else {
        return Err(ProbeError {
            kind: "not-found".to_string(),
            message: format!("Cannot spawn: {command}"),
        });
    };

    let duration = Duration::from_millis(timeout_ms);
    match tokio::time::timeout(duration, cmd.wait_with_output()).await {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(e)) => Err(ProbeError {
            kind: "failed".to_string(),
            message: format!("Process error: {e}"),
        }),
        Err(_elapsed) => {
            // timeout: kill_on_drop handles the child
            Err(ProbeError {
                kind: "timeout".to_string(),
                message: format!("Timed out after {timeout_ms}ms"),
            })
        }
    }
}

/// Reads a text file and returns its contents (byte-faithful). Matches
/// ProbeExecutor.readTextFile().
#[tauri::command]
async fn probe_read_text_file(path: String) -> ProbeResultPayload {
    match fs::read_to_string(&path) {
        Ok(contents) => ProbeResultPayload {
            ok: true,
            stdout: contents,
            stderr: String::new(),
            exit_code: 0,
            reason: None,
            detail: None,
        },
        Err(e) => {
            let (kind, detail) = match e.kind() {
                std::io::ErrorKind::NotFound => ("not-found", format!("File not found: {path}")),
                std::io::ErrorKind::PermissionDenied => {
                    ("denied", format!("Permission denied: {path}"))
                }
                _ => ("failed", format!("IO error: {e}")),
            };
            ProbeResultPayload {
                ok: false,
                stdout: String::new(),
                stderr: String::new(),
                exit_code: -1,
                reason: Some(kind.to_string()),
                detail: Some(detail),
            }
        }
    }
}

/// Free-space check against the volume backing a given path. Matches
/// ProbeExecutor.statfs().
#[tauri::command]
async fn probe_statfs(path: String) -> Result<serde_json::Value, String> {
    #[cfg(target_family = "unix")]
    {
        use std::mem::MaybeUninit;
        let path_c = std::ffi::CString::new(path.as_str())
            .map_err(|e| format!("Invalid path: {e}"))?;
        let mut stat: MaybeUninit<libc::statvfs> = MaybeUninit::uninit();
        // SAFETY: statvfs is safe to call on a valid C string; the struct
        // is initialised by the kernel before returning.
        let ret = unsafe { libc::statvfs(path_c.as_ptr(), stat.as_mut_ptr()) };
        if ret != 0 {
            return Ok(serde_json::json!({"ok": false}));
        }
        // SAFETY: statvfs returned 0, so the struct is fully initialised.
        let info = unsafe { stat.assume_init() };
        let free_bytes: u64 = info.f_frsize as u64 * info.f_bavail as u64;
        return Ok(serde_json::json!({"freeBytes": free_bytes}));
    }

    #[cfg(not(target_family = "unix"))]
    {
        // On Windows, return unsupported rather than failing. The probe
        // degrades gracefully when statfs is unavailable.
        let _ = path;
        Ok(serde_json::json!({"ok": false}))
    }
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

/// Validates that a webview-supplied relative path stays inside the assets
/// dir. Rejects absolute paths and any `.`/`..`/prefix/root components while
/// allowing plain nested relative paths such as `onnx/model_quantized.onnx`.
///
/// C-389 CR: the three model-asset commands accept strings from the webview;
/// without this guard a hostile payload (`../../etc/passwd`) could read,
/// overwrite, or delete files anywhere the app user can reach.
fn safe_asset_path(dir: &Path, file_name: &str) -> Result<PathBuf, String> {
    let path = Path::new(file_name);
    if path.is_absolute() {
        return Err(format!("Invalid asset path (absolute): {file_name}"));
    }
    for component in path.components() {
        match component {
            Component::Normal(_) => {}
            _ => return Err(format!("Invalid asset path: {file_name}")),
        }
    }
    if file_name.is_empty() {
        return Err("Invalid asset path (empty)".to_string());
    }
    Ok(dir.join(path))
}

/// Reads `models.originUrl` from the runtime config in the app data dir.
/// The Rust-side download is only allowed to fetch from this origin.
fn configured_model_origin(app: &tauri::AppHandle) -> Result<String, String> {
    let dir = assets_dir(app)?;
    let path = dir.join(CONFIG_FILE);
    if !path.exists() {
        return Err("No runtime config — model origin is not configured".to_string());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("Cannot read config: {e}"))?;
    let parsed: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("Cannot parse config: {e}"))?;
    parsed
        .get("models")
        .and_then(|m| m.get("originUrl"))
        .and_then(|u| u.as_str())
        .map(|s| s.trim_end_matches('/').to_string())
        .ok_or_else(|| "models.originUrl is missing from config".to_string())
}

/// Validates a download URL against the configured model origin: same scheme
/// and same host. Redirects are disabled on the HTTP client so a 3xx cannot
/// silently move the fetch off-origin.
fn validate_model_download_url(origin: &str, url: &str) -> Result<(), String> {
    let origin_parsed =
        Url::parse(origin).map_err(|e| format!("Invalid configured model origin: {e}"))?;
    let url_parsed = Url::parse(url).map_err(|e| format!("Invalid download URL: {e}"))?;
    if url_parsed.scheme() != origin_parsed.scheme()
        || url_parsed.host_str() != origin_parsed.host_str()
    {
        return Err(format!(
            "Download URL does not match configured model origin ({origin})"
        ));
    }
    Ok(())
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
/// its SHA-256 checksum and expected size, and writes it into the app data
/// directory. Progress is emitted as `model-download-progress` events. C-389
/// AC-5.
///
/// Security (C-389 CR): the URL is restricted to the configured model origin
/// with redirects disabled, the target path is validated to stay inside the
/// assets dir, and the stream is capped at `expected_size` and buffered to a
/// temp file that is renamed into place only after checksum + size verify.
#[tauri::command]
async fn download_model_file(
    app: tauri::AppHandle,
    url: String,
    checksum: String,
    file_name: String,
    expected_size: u64,
) -> Result<(), String> {
    let dir = assets_dir(&app)?;
    let path = safe_asset_path(&dir, &file_name)?;

    // Only fetch from the configured model origin; never follow redirects
    // off-origin (a 3xx is treated as a failure by the status check).
    let origin = configured_model_origin(&app)?;
    validate_model_download_url(&origin, &url)?;

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("Cannot build HTTP client: {e}"))?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Download failed (HTTP {status})"));
    }
    let total_bytes = response.content_length().unwrap_or(expected_size);

    // Stream to a `.part` temp file in the same directory; rename into place
    // only after size + checksum verification so a corrupt/partial download
    // never shadows a previously good file.
    let parent = path.parent().unwrap_or(&dir);
    fs::create_dir_all(parent).map_err(|e| format!("Cannot create model dir: {e}"))?;
    let temp_name = format!(
        "{}.part",
        path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("model")
    );
    let temp_path = parent.join(temp_name);

    let cleanup = |temp_path: &Path| {
        let _ = fs::remove_file(temp_path);
    };

    let mut file =
        fs::File::create(&temp_path).map_err(|e| format!("Cannot create temp file: {e}"))?;
    let mut hasher = Sha256::new();
    let mut received_bytes: u64 = 0;
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download stream error: {e}"))?;
        received_bytes += chunk.len() as u64;
        if received_bytes > expected_size {
            cleanup(&temp_path);
            return Err(format!(
                "Download exceeded expected size ({expected_size} bytes)"
            ));
        }
        hasher.update(&chunk);
        file.write_all(&chunk)
            .map_err(|e| format!("Cannot write temp file: {e}"))?;
        let _ = app.emit(
            "model-download-progress",
            serde_json::json!({
                "file": file_name,
                "receivedBytes": received_bytes,
                "totalBytes": total_bytes,
            }),
        );
    }
    file.flush()
        .map_err(|e| format!("Cannot flush temp file: {e}"))?;

    if received_bytes != expected_size {
        cleanup(&temp_path);
        return Err(format!(
            "Size mismatch for {file_name}: expected {expected_size}, got {received_bytes}"
        ));
    }

    let digest = hasher.finalize();
    let digest_hex = hex::encode(digest);
    if digest_hex != checksum {
        cleanup(&temp_path);
        return Err(format!(
            "Checksum mismatch for {file_name}: expected {checksum}, got {digest_hex}"
        ));
    }

    fs::rename(&temp_path, &path).map_err(|e| format!("Cannot finalize model file: {e}"))?;
    Ok(())
}

/// Reads a previously downloaded model asset back as raw bytes so the webview
/// can pre-warm its Cache Storage for the worker. C-389 AC-5.
///
/// C-389 CR: returns `tauri::ipc::Response` so the bytes travel as a raw
/// payload instead of a JSON array, and validates the path stays inside the
/// assets dir.
#[tauri::command]
fn read_model_file(
    app: tauri::AppHandle,
    file_name: String,
) -> Result<tauri::ipc::Response, String> {
    let path = safe_asset_path(&assets_dir(&app)?, &file_name)?;
    let bytes = fs::read(&path).map_err(|e| format!("Cannot read model file {file_name}: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Removes cached model assets from the app data directory (AC-4c delete).
#[tauri::command]
fn delete_model_files(app: tauri::AppHandle, files: Vec<String>) -> Result<(), String> {
    let dir = assets_dir(&app)?;
    for file in files {
        let path = safe_asset_path(&dir, &file)?;
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
            // Register the aikami:// URL scheme in the OS at runtime. The
            // deep-link plugin only registers schemes via the installer
            // otherwise, so launching the release binary without installing
            // (bun run tauri:run) leaves aikami:// unhandled and the browser
            // tab's device-link redirect fails with "scheme does not have a
            // registered handler". register_all() covers the uninstalled
            // case (plugin docs); on macOS it's a no-op/unsupported and on
            // Linux it needs xdg-mime, so failures are logged, never fatal.
            if let Err(err) = app.deep_link().register_all() {
                eprintln!("deep-link: register_all failed: {err}");
            }

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
        .plugin(tauri_plugin_shell::init())
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
            delete_model_files,
            probe_run,
            probe_read_text_file,
            probe_statfs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
