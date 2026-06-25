use crate::error::{AppError, ErrorKind};
use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize, Clone)]
pub struct FilePayload {
    pub path: String,
    pub content: String,
}

#[tauri::command]
pub fn read_file(path: String) -> Result<FilePayload, AppError> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(AppError::new(
            ErrorKind::NotFound,
            format!("File not found: {path}"),
        ));
    }
    let bytes = fs::read(p).map_err(|e| AppError::new(ErrorKind::Unreadable, e.to_string()))?;
    let content = String::from_utf8(bytes)
        .map_err(|_| AppError::new(ErrorKind::NotUtf8, "File is not valid UTF-8"))?;
    Ok(FilePayload { path, content })
}

#[tauri::command]
pub fn save_text_file(path: String, contents: String) -> Result<(), AppError> {
    std::fs::write(&path, contents).map_err(|e| AppError::new(ErrorKind::Io, e.to_string()))
}

/// True if a path has a Markdown-ish extension we render.
pub fn is_markdown(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()),
        Some(ref e) if e == "md" || e == "markdown" || e == "mdown" || e == "mkd"
    )
}

/// Sorted absolute paths of Markdown files in the same directory as `path`
/// (including `path` itself). Used by the "next file in directory" navigation.
#[tauri::command]
pub fn list_sibling_markdown(path: String) -> Result<Vec<String>, AppError> {
    let p = Path::new(&path);
    let dir = p
        .parent()
        .ok_or_else(|| AppError::new(ErrorKind::Io, "No parent directory"))?;
    let mut files: Vec<String> = std::fs::read_dir(dir)
        .map_err(|e| AppError::new(ErrorKind::Io, e.to_string()))?
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|p| p.is_file() && is_markdown(p))
        .map(|p| p.to_string_lossy().to_string())
        .collect();
    files.sort();
    Ok(files)
}

/// Write `contents` to a file named `filename` inside the OS temp dir and return
/// its absolute path. Used to stage the standalone HTML for browser-based PDF export.
#[tauri::command]
pub fn write_temp_file(filename: String, contents: String) -> Result<String, AppError> {
    let path = std::env::temp_dir().join(filename);
    std::fs::write(&path, contents).map_err(|e| AppError::new(ErrorKind::Io, e.to_string()))?;
    Ok(path.to_string_lossy().to_string())
}

/// Resolve a relative link (`rel`) against the directory of the open file
/// (`base`) to an absolute path. Used for clicking relative `.md` links.
#[tauri::command]
pub fn resolve_sibling(base: String, rel: String) -> Result<String, AppError> {
    let base_dir = Path::new(&base)
        .parent()
        .ok_or_else(|| AppError::new(ErrorKind::Io, "No parent directory"))?;
    let joined = base_dir.join(rel);
    std::fs::canonicalize(&joined)
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| AppError::new(ErrorKind::NotFound, e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn reads_existing_utf8_file() {
        let dir = std::env::temp_dir().join("mdv_test_read");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("a.md");
        let mut f = std::fs::File::create(&path).unwrap();
        f.write_all(b"# Hello").unwrap();
        let payload = read_file(path.to_string_lossy().to_string()).unwrap();
        assert_eq!(payload.content, "# Hello");
    }

    #[test]
    fn errors_on_missing_file() {
        let err = read_file("/no/such/file.md".into()).unwrap_err();
        assert!(matches!(err.kind, ErrorKind::NotFound));
    }

    #[test]
    fn errors_on_non_utf8() {
        let dir = std::env::temp_dir().join("mdv_test_read");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("bin.md");
        std::fs::write(&path, [0xff, 0xfe, 0x00]).unwrap();
        let err = read_file(path.to_string_lossy().to_string()).unwrap_err();
        assert!(matches!(err.kind, ErrorKind::NotUtf8));
    }

    #[test]
    fn writes_text_file() {
        let dir = std::env::temp_dir().join("mdv_test_save");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("out.html");
        save_text_file(path.to_string_lossy().to_string(), "<h1>Hi</h1>".into()).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "<h1>Hi</h1>");
    }

    #[test]
    fn is_markdown_recognizes_extensions() {
        assert!(is_markdown(Path::new("/x/a.md")));
        assert!(is_markdown(Path::new("/x/a.MARKDOWN")));
        assert!(!is_markdown(Path::new("/x/a.txt")));
        assert!(!is_markdown(Path::new("/x/a")));
    }

    #[test]
    fn resolves_relative_sibling_path() {
        let dir = std::env::temp_dir().join("mdv_test_resolve");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.md"), "a").unwrap();
        std::fs::write(dir.join("b.md"), "b").unwrap();
        let base = dir.join("a.md").to_string_lossy().to_string();
        let resolved = resolve_sibling(base, "b.md".into()).unwrap();
        assert!(resolved.ends_with("b.md"));
    }

    #[test]
    fn lists_sorted_sibling_markdown_only() {
        let dir = std::env::temp_dir().join("mdv_test_siblings");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("b.md"), "b").unwrap();
        std::fs::write(dir.join("a.md"), "a").unwrap();
        std::fs::write(dir.join("note.txt"), "x").unwrap();
        let list = list_sibling_markdown(dir.join("a.md").to_string_lossy().to_string()).unwrap();
        assert_eq!(list.len(), 2);
        assert!(list[0].ends_with("a.md"));
        assert!(list[1].ends_with("b.md"));
    }
}
