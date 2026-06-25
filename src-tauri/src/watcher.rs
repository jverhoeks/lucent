use crate::commands::{read_file, FilePayload};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

/// Pure, testable: read the file fresh; None if it can't be read (e.g. removed).
pub fn reload_payload(path: &str) -> Option<FilePayload> {
    read_file(path.to_string()).ok()
}

/// Pure, testable: does this filesystem event concern the file we care about?
///
/// We watch the *parent directory* (not the file) so that atomic saves
/// (write-temp-then-rename, which many editors use) are still detected — those
/// arrive as create/rename events on the target path within the directory.
pub fn event_targets(event_paths: &[PathBuf], target: &Path) -> bool {
    event_paths.iter().any(|p| p == target)
}

#[derive(serde::Serialize, Clone)]
struct RemovedPayload {
    path: String,
}

/// Holds one active watcher per open document, keyed by file path. Removing an
/// entry drops its watcher and stops that watch.
#[derive(Default)]
pub struct WatchState {
    pub watchers: Mutex<HashMap<String, RecommendedWatcher>>,
}

#[tauri::command]
pub fn watch_file(path: String, state: State<WatchState>, app: AppHandle) -> Result<(), String> {
    let target = PathBuf::from(&path);
    // Watch the containing directory so atomic saves (rename onto the path) are
    // caught; fall back to watching the file itself if it has no parent.
    let watch_root = target
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| target.clone());

    let app2 = app.clone();
    let path2 = path.clone();
    let target2 = target.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            if !event_targets(&event.paths, &target2) {
                return;
            }
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
        .watch(&watch_root, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;
    // Replace any prior watcher for this path; insert the new one.
    state.watchers.lock().unwrap().insert(path, watcher);
    Ok(())
}

#[tauri::command]
pub fn unwatch_file(path: String, state: State<WatchState>) {
    state.watchers.lock().unwrap().remove(&path);
}

#[tauri::command]
pub fn unwatch_all(state: State<WatchState>) {
    state.watchers.lock().unwrap().clear();
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

    #[test]
    fn event_targets_matches_only_the_watched_file() {
        let target = PathBuf::from("/tmp/dir/note.md");
        assert!(event_targets(&[PathBuf::from("/tmp/dir/note.md")], &target));
        // Sibling files in the same watched directory are ignored.
        assert!(!event_targets(&[PathBuf::from("/tmp/dir/other.md")], &target));
        // An atomic-save temp file is ignored; the final rename onto the target matches.
        assert!(!event_targets(&[PathBuf::from("/tmp/dir/.note.md.tmp")], &target));
        assert!(event_targets(
            &[
                PathBuf::from("/tmp/dir/.note.md.tmp"),
                PathBuf::from("/tmp/dir/note.md")
            ],
            &target
        ));
    }
}
