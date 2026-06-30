mod commands;
mod error;
mod logindex;
mod pdf;
mod stdin;
mod watcher;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

/// Files queued to open at startup: CLI args on Windows/Linux (`lucent *.md`),
/// or, on macOS, paths from a `RunEvent::Opened` (Finder double-click / `open
/// -a Lucent file.md`) that arrived before the frontend was ready. The path is
/// NOT in argv on macOS, hence the event handling in `run`.
///
/// Drained exactly once by `get_startup_files`; after that, opens are delivered
/// live via the `open-files` event instead.
#[derive(Default)]
pub struct StartupFiles {
    files: Mutex<Vec<String>>,
    consumed: AtomicBool,
}

#[tauri::command]
fn get_startup_files(state: tauri::State<StartupFiles>) -> Vec<String> {
    // From here on, late opens go out as `open-files` events (see `run`).
    state.consumed.store(true, Ordering::SeqCst);
    std::mem::take(&mut *state.files.lock().unwrap())
}

/// Keep only existing, viewable files; canonicalize to absolute paths. Shared
/// by the argv scan and the macOS open-event handler so both apply the same
/// gate that protects relative-link navigation elsewhere.
fn filter_viewable<I: IntoIterator<Item = PathBuf>>(paths: I) -> Vec<String> {
    paths
        .into_iter()
        .filter(|p| p.is_file() && commands::is_viewable(p))
        .filter_map(|p| std::fs::canonicalize(&p).ok())
        .map(|c| c.to_string_lossy().to_string())
        .collect()
}

fn collect_startup_files() -> Vec<String> {
    filter_viewable(
        std::env::args()
            .skip(1)
            .filter(|a| !a.starts_with('-'))
            .map(PathBuf::from),
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let stdin_buf = stdin::new_buffer();
    let reader_buf = stdin_buf.clone();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(watcher::WatchState::default())
        .manage(stdin_buf)
        .manage(logindex::LogIndexState::default())
        .manage(StartupFiles {
            files: Mutex::new(collect_startup_files()),
            consumed: AtomicBool::new(false),
        })
        .setup(move |app| {
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, _event| {
        // macOS delivers "open this file with Lucent" as an Apple Event,
        // surfaced as RunEvent::Opened — the path never reaches argv. The
        // variant only exists on macOS/iOS, so the whole arm must be cfg-gated
        // or the Windows/Linux release builds fail to compile.
        #[cfg(target_os = "macos")]
        {
            use tauri::{Emitter, Manager};
            if let tauri::RunEvent::Opened { urls } = _event {
                let paths =
                    filter_viewable(urls.into_iter().filter_map(|u| u.to_file_path().ok()));
                if !paths.is_empty() {
                    let state = _app_handle.state::<StartupFiles>();
                    if state.consumed.load(Ordering::SeqCst) {
                        // Frontend is up — open immediately.
                        let _ = _app_handle.emit("open-files", paths);
                    } else {
                        // Cold start: queue for the one-shot startup drain.
                        state.files.lock().unwrap().extend(paths);
                    }
                }
            }
        }
    });
}
