mod commands;
mod error;
mod logindex;
mod pdf;
mod stdin;
mod watcher;

use std::path::Path;
use tauri::Manager;

/// Viewable file paths passed on the command line (e.g. `lucent *.md *.json`),
/// resolved to absolute paths at startup and exposed to the frontend.
#[derive(Default)]
pub struct StartupFiles(pub Vec<String>);

#[tauri::command]
fn get_startup_files(state: tauri::State<StartupFiles>) -> Vec<String> {
    state.0.clone()
}

fn collect_startup_files() -> Vec<String> {
    std::env::args()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .filter_map(|a| {
            let p = Path::new(&a);
            if p.is_file() && commands::is_viewable(p) {
                std::fs::canonicalize(p)
                    .ok()
                    .map(|c| c.to_string_lossy().to_string())
            } else {
                None
            }
        })
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let stdin_buf = stdin::new_buffer();
    let reader_buf = stdin_buf.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(watcher::WatchState::default())
        .manage(stdin_buf)
        .manage(logindex::LogIndexState::default())
        .setup(move |app| {
            app.manage(StartupFiles(collect_startup_files()));
            stdin::spawn_reader(app.handle().clone(), reader_buf);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::read_file,
            commands::save_text_file,
            commands::list_sibling_viewable,
            commands::write_temp_file,
            commands::resolve_sibling,
            commands::probe_is_text,
            commands::list_viewable_recursive,
            watcher::watch_file,
            watcher::unwatch_file,
            watcher::unwatch_all,
            pdf::export_pdf_native,
            stdin::stdin_lines,
            get_startup_files,
            logindex::log_open,
            logindex::log_window,
            logindex::log_search,
            logindex::file_size
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
