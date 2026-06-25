mod commands;
mod error;
mod watcher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(watcher::WatchState::default())
        .invoke_handler(tauri::generate_handler![
            commands::read_file,
            commands::save_text_file,
            watcher::watch_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
