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
}
