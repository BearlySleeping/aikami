// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Aikami.", name)
}

/// Parse a `--route <path>` argument from CLI args, if present.
/// Returns `Some(path)` to navigate to on startup, or `None` to load the default root.
fn parse_startup_route() -> Option<String> {
    std::env::args()
        .collect::<Vec<_>>()
        .windows(2)
        .find(|w| w[0] == "--route")
        .map(|w| w[1].clone())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Log CLI args for debugging
    let args: Vec<String> = std::env::args().collect();
    println!("Tauri startup — CLI args: {:?}", &args);

    let startup_route = parse_startup_route();
    println!("Tauri startup — parsed route: {:?}", &startup_route);

    tauri::Builder::default()
        .setup(move |app| {
            println!("Tauri setup — configuring window...");

            // Log available windows
            let window_labels: Vec<_> = app.webview_windows().keys().cloned().collect();
            println!("Tauri setup — window labels: {:?}", window_labels);

            if let Some(route) = startup_route {
                let handle = app.handle().clone();
                println!("Tauri setup — scheduling navigation to '{}' in 2s...", route);
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(2));
                    match handle.get_webview_window("main") {
                        Some(window) => {
                            let js = format!("console.log('[Tauri] navigating to {}'); window.location.href = '{}';", route, route);
                            match window.eval(&js) {
                                Ok(_) => println!("Tauri — eval sent, navigating to {}", route),
                                Err(e) => eprintln!("Tauri — eval failed: {}", e),
                            }
                        }
                        None => {
                            eprintln!("Tauri — main window not found during route setup");
                            // Try listing windows again
                            let labels: Vec<_> = handle.webview_windows().keys().cloned().collect();
                            eprintln!("Tauri — available windows at navigation time: {:?}", labels);
                        }
                    }
                });
            }
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
