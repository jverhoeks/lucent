use crate::commands::{read_file, FilePayload};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

/// Pure, testable: read the file fresh; None if it can't be read (e.g. removed).
pub fn reload_payload(path: &str) -> Option<FilePayload> {
    read_file(path.to_string()).ok()
}

#[derive(serde::Serialize, Clone)]
struct RemovedPayload {
    path: String,
}

/// Holds the active watcher. Dropping it (by replacing) stops the previous watch.
#[derive(Default)]
pub struct WatchState {
    pub watcher: Mutex<Option<RecommendedWatcher>>,
}

#[tauri::command]
pub fn watch_file(path: String, state: State<WatchState>, app: AppHandle) -> Result<(), String> {
    let watch_path = PathBuf::from(&path);
    let app2 = app.clone();
    let path2 = path.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            match event.kind {
                EventKind::Modify(_) | EventKind::Create(_) => {
                    if let Some(payload) = reload_payload(&path2) {
                        let _ = app2.emit("file-changed", payload);
                    }
                }
                EventKind::Remove(_) => {
                    let _ = app2.emit("file-removed", RemovedPayload { path: path2.clone() });
                }
                _ => {}
            }
        }
    })
    .map_err(|e| e.to_string())?;
    watcher
        .watch(&watch_path, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;
    // Replace any prior watcher (dropping it stops the old watch).
    *state.watcher.lock().unwrap() = Some(watcher);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reload_returns_fresh_content() {
        let dir = std::env::temp_dir().join("mdv_test_watch");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("w.md");
        std::fs::write(&path, "v1").unwrap();
        let p = path.to_string_lossy().to_string();
        assert_eq!(reload_payload(&p).unwrap().content, "v1");
        std::fs::write(&path, "v2").unwrap();
        assert_eq!(reload_payload(&p).unwrap().content, "v2");
    }

    #[test]
    fn reload_none_when_missing() {
        assert!(reload_payload("/no/such/watch.md").is_none());
    }
}
