use crate::error::{AppError, ErrorKind};
use memmap2::Mmap;
use serde::Serialize;
use std::io::Read;
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
    let file =
        std::fs::File::open(p).map_err(|e| AppError::new(ErrorKind::Unreadable, e.to_string()))?;
    let mmap =
        unsafe { Mmap::map(&file) }.map_err(|e| AppError::new(ErrorKind::Unreadable, e.to_string()))?;
    let content = String::from_utf8(mmap[..].to_vec())
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

/// True if a path is something this viewer is allowed to open (markdown,
/// plain text, or structured data). Used to gate relative-link navigation so a
/// crafted link can't coax the app into reading arbitrary files (e.g. keys,
/// /etc/passwd).
pub fn is_viewable(path: &Path) -> bool {
    if is_markdown(path) {
        return true;
    }
    matches!(
        path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()),
        Some(ref e) if e == "txt" || e == "log" || e == "text"
            || e == "json" || e == "yaml" || e == "yml" || e == "toml" || e == "ini"
    )
}

/// The filename portion of a path string (handles `/` and `\`).
fn file_basename(p: &str) -> &str {
    p.rsplit(|c| c == '/' || c == '\\').next().unwrap_or(p)
}

/// Compare two names the way macOS Finder's "by name" sort does (approximately):
/// case-insensitive with natural, numeric-aware ordering — so `file2` sorts
/// before `file10`, and `README` sorts among the lowercase names rather than
/// before them (which a raw byte sort would get wrong).
fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let a = a.to_lowercase();
    let b = b.to_lowercase();
    let mut ai = a.chars().peekable();
    let mut bi = b.chars().peekable();
    loop {
        match (ai.peek().copied(), bi.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(x), Some(y)) => {
                if x.is_ascii_digit() && y.is_ascii_digit() {
                    let mut an = String::new();
                    while let Some(&c) = ai.peek() {
                        if c.is_ascii_digit() { an.push(c); ai.next(); } else { break; }
                    }
                    let mut bn = String::new();
                    while let Some(&c) = bi.peek() {
                        if c.is_ascii_digit() { bn.push(c); bi.next(); } else { break; }
                    }
                    // Compare numerically: ignore leading zeros, then by length, then digits.
                    let at = an.trim_start_matches('0');
                    let bt = bn.trim_start_matches('0');
                    let ord = at.len().cmp(&bt.len()).then_with(|| at.cmp(bt));
                    if ord != Ordering::Equal {
                        return ord;
                    }
                    // Numeric tie (e.g. "01" vs "1"): fall through to keep comparing.
                } else {
                    let ord = x.cmp(&y);
                    if ord != Ordering::Equal {
                        return ord;
                    }
                    ai.next();
                    bi.next();
                }
            }
        }
    }
}

/// Sorted absolute paths of viewable files in the same directory as `path`
/// (including `path` itself). Used by the "next file in directory" navigation,
/// which cycles through every file type Lucent can open. Order matches Finder's
/// case-insensitive natural sort (see `natural_cmp`).
#[tauri::command]
pub fn list_sibling_viewable(path: String) -> Result<Vec<String>, AppError> {
    let p = Path::new(&path);
    let dir = p
        .parent()
        .ok_or_else(|| AppError::new(ErrorKind::Io, "No parent directory"))?;
    let mut files: Vec<String> = std::fs::read_dir(dir)
        .map_err(|e| AppError::new(ErrorKind::Io, e.to_string()))?
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|p| p.is_file() && is_viewable(p))
        .map(|p| p.to_string_lossy().to_string())
        .collect();
    files.sort_by(|a, b| natural_cmp(file_basename(a), file_basename(b)));
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
    // Reject absolute targets outright; relative links must stay relative.
    if Path::new(&rel).is_absolute() {
        return Err(AppError::new(
            ErrorKind::Io,
            "Absolute link targets are not allowed",
        ));
    }
    let base_dir = Path::new(&base)
        .parent()
        .ok_or_else(|| AppError::new(ErrorKind::Io, "No parent directory"))?;
    let target = std::fs::canonicalize(base_dir.join(rel))
        .map_err(|e| AppError::new(ErrorKind::NotFound, e.to_string()))?;
    // Only allow opening viewable files via links — a crafted link must not be
    // able to read arbitrary files (keys, system files, etc.).
    if !is_viewable(&target) {
        return Err(AppError::new(
            ErrorKind::Io,
            "Only viewable files (markdown, text, data, logs) can be opened",
        ));
    }
    Ok(target.to_string_lossy().to_string())
}

/// Probe whether a file is text by reading its first `max_bytes` and checking
/// for null bytes. Files with known viewable extensions skip the probe.
/// Returns `true` if the file is likely text or has a viewable extension.
#[tauri::command]
pub fn probe_is_text(path: String, max_bytes: u64) -> Result<bool, AppError> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(AppError::new(ErrorKind::NotFound, format!("File not found: {path}")));
    }
    // Known viewable extension → no probe needed
    if is_viewable(p) || is_markdown(p) {
        return Ok(true);
    }
    // Read first max_bytes and check for null bytes (binary indicator)
    let file = std::fs::File::open(p).map_err(|e| AppError::new(ErrorKind::Unreadable, e.to_string()))?;
    let mut buf = vec![0u8; max_bytes as usize];
    let n = file.take(max_bytes).read(&mut buf).map_err(|e| AppError::new(ErrorKind::Unreadable, e.to_string()))?;
    Ok(!buf[..n].contains(&0u8))
}

/// Recursively collect viewable file paths under `path` (file or directory).
/// If `path` is a file, returns it if viewable; if a directory, walks it
/// recursively (up to a reasonable depth).
#[tauri::command]
pub fn list_viewable_recursive(path: String) -> Result<Vec<String>, AppError> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(AppError::new(ErrorKind::NotFound, format!("Path not found: {path}")));
    }
    let mut results = Vec::new();
    walk_viewable(p, &mut results, 0)?;
    results.sort_by(|a, b| natural_cmp(file_basename(a), file_basename(b)));
    Ok(results)
}

fn walk_viewable(p: &Path, results: &mut Vec<String>, depth: u32) -> Result<(), AppError> {
    if depth > 32 {
        return Ok(()); // safety limit
    }
    if p.is_file() {
        if is_viewable(p) || is_markdown(p) {
            results.push(p.to_string_lossy().to_string());
        }
        return Ok(());
    }
    if p.is_dir() {
        for entry in std::fs::read_dir(p).map_err(|e| AppError::new(ErrorKind::Io, e.to_string()))? {
            let entry = entry.map_err(|e| AppError::new(ErrorKind::Io, e.to_string()))?;
            walk_viewable(&entry.path(), results, depth + 1)?;
        }
    }
    Ok(())
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
    fn is_viewable_recognizes_data_extensions() {
        // data formats
        assert!(is_viewable(Path::new("/x/a.json")));
        assert!(is_viewable(Path::new("/x/a.JSON")));
        assert!(is_viewable(Path::new("/x/a.yaml")));
        assert!(is_viewable(Path::new("/x/a.yml")));
        assert!(is_viewable(Path::new("/x/a.toml")));
        assert!(is_viewable(Path::new("/x/a.ini")));
        // markdown still viewable
        assert!(is_viewable(Path::new("/x/a.md")));
        // text/log still viewable
        assert!(is_viewable(Path::new("/x/a.txt")));
        assert!(is_viewable(Path::new("/x/a.log")));
        // binary/image not viewable
        assert!(!is_viewable(Path::new("/x/a.png")));
        assert!(!is_viewable(Path::new("/x/a.key")));
        assert!(!is_viewable(Path::new("/x/a")));
    }

    #[test]
    fn resolves_relative_sibling_path() {
        let dir = std::env::temp_dir().join("mdv_test_resolve");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.md"), "a").unwrap();
        std::fs::write(dir.join("b.md"), "b").unwrap();
        std::fs::write(dir.join("secret.key"), "shh").unwrap();
        let base = dir.join("a.md").to_string_lossy().to_string();

        // Markdown sibling resolves.
        let resolved = resolve_sibling(base.clone(), "b.md".into()).unwrap();
        assert!(resolved.ends_with("b.md"));

        // Non-viewable extensions are refused (no arbitrary file reads).
        assert!(resolve_sibling(base.clone(), "secret.key".into()).is_err());

        // Absolute targets are refused.
        assert!(resolve_sibling(base, "/etc/passwd".into()).is_err());
    }

    #[test]
    fn lists_sorted_sibling_viewable_all_types() {
        let dir = std::env::temp_dir().join("mdv_test_siblings");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("b.md"), "b").unwrap();
        std::fs::write(dir.join("a.md"), "a").unwrap();
        std::fs::write(dir.join("c.json"), "{}").unwrap();
        std::fs::write(dir.join("note.txt"), "x").unwrap();
        std::fs::write(dir.join("ignore.png"), "x").unwrap(); // not viewable
        let list = list_sibling_viewable(dir.join("a.md").to_string_lossy().to_string()).unwrap();
        // All viewable types are listed (md, json, txt), sorted; the .png is excluded.
        assert_eq!(list.len(), 4);
        assert!(list[0].ends_with("a.md"));
        assert!(list[1].ends_with("b.md"));
        assert!(list[2].ends_with("c.json"));
        assert!(list[3].ends_with("note.txt"));
        assert!(!list.iter().any(|f| f.ends_with(".png")));
    }

    #[test]
    fn natural_cmp_is_case_insensitive_and_numeric() {
        let mut v = vec![
            "file10.md", "File2.md", "apple.txt", "Banana.txt", "README.md", "10.log", "2.log",
        ];
        v.sort_by(|a, b| natural_cmp(a, b));
        // Numeric-aware (2 before 10), case-insensitive (Banana among a/f, README among r).
        assert_eq!(
            v,
            vec![
                "2.log", "10.log", "apple.txt", "Banana.txt", "File2.md", "file10.md", "README.md",
            ]
        );
    }
}
