// apps/frontend/client/src-tauri/src/lib.rs
// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

use tauri::Emitter;
use tauri_plugin_deep_link::DeepLinkExt;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Aikami.", name)
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
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
