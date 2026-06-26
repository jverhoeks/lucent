use crate::error::{AppError, ErrorKind};
use regex::RegexBuilder;
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::sync::Mutex;

/// Byte-offset index for a log file.
///
/// Each entry in `offsets` is the byte position of the start of that line.
/// After `build`, `indexed_len` equals the number of bytes scanned (i.e., the
/// file size at index time).  `extend()` re-opens the file and scans forward
/// from `indexed_len`, appending any new line-start offsets.
pub struct LineIndex {
    path: String,
    /// `offsets[i]` = byte offset at which line `i` starts.
    offsets: Vec<u64>,
    /// How many bytes of the file have been scanned so far.
    indexed_len: u64,
}

impl LineIndex {
    /// Scan `path` from byte 0 and build a fresh index.
    pub fn build(path: &str) -> Result<Self, AppError> {
        let mut idx = LineIndex {
            path: path.to_owned(),
            offsets: Vec::new(),
            indexed_len: 0,
        };
        idx.scan_from(0)?;
        Ok(idx)
    }

    /// Number of lines currently indexed.
    pub fn line_count(&self) -> usize {
        self.offsets.len()
    }

    /// Return up to `count` lines starting at 0-based line `start`.
    ///
    /// Clamps to the end of the file if `start + count` exceeds `line_count()`.
    /// Uses `from_utf8_lossy` so invalid UTF-8 bytes are replaced with U+FFFD.
    pub fn window(&self, start: usize, count: usize) -> Vec<String> {
        if start >= self.offsets.len() {
            return Vec::new();
        }
        let end = (start + count).min(self.offsets.len());
        let mut file = match File::open(&self.path) {
            Ok(f) => f,
            Err(_) => return Vec::new(),
        };
        let byte_start = self.offsets[start];
        if file.seek(SeekFrom::Start(byte_start)).is_err() {
            return Vec::new();
        }
        let mut reader = BufReader::new(file);
        let mut lines = Vec::with_capacity(end - start);
        for _ in start..end {
            let mut buf = Vec::new();
            match reader.read_until(b'\n', &mut buf) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    // Strip trailing \r\n or \n.
                    if buf.ends_with(b"\r\n") {
                        buf.truncate(buf.len() - 2);
                    } else if buf.ends_with(b"\n") {
                        buf.truncate(buf.len() - 1);
                    }
                    lines.push(String::from_utf8_lossy(&buf).into_owned());
                }
            }
        }
        lines
    }

    /// Return 0-based indices of lines that match `query`.
    ///
    /// Delegates to the free function `search_file` so the caller can hold no
    /// lock while the scan runs.  See `log_search` for the pattern.
    pub fn search(&self, query: &str, case_sensitive: bool, regex: bool) -> Vec<usize> {
        search_file(&self.path, query, case_sensitive, regex)
    }

    /// Re-scan bytes appended since the last `build`/`extend` call.
    #[allow(dead_code)]
    ///
    /// After a log file is appended to, call `extend()` to pick up the new
    /// lines without re-reading the whole file.
    pub fn extend(&mut self) -> Result<(), AppError> {
        let current_len = std::fs::metadata(&self.path)
            .map(|m| m.len())
            .map_err(|e| AppError::new(ErrorKind::Io, e.to_string()))?;
        if current_len > self.indexed_len {
            self.scan_from(self.indexed_len)?;
        }
        Ok(())
    }

    /// Scan the file starting at `from_offset`, appending discovered line-start
    /// offsets to `self.offsets` and updating `self.indexed_len`.
    fn scan_from(&mut self, from_offset: u64) -> Result<(), AppError> {
        let mut file =
            File::open(&self.path).map_err(|e| AppError::new(ErrorKind::NotFound, e.to_string()))?;
        file.seek(SeekFrom::Start(from_offset))
            .map_err(|e| AppError::new(ErrorKind::Io, e.to_string()))?;

        // Push `from_offset` as a line-start only when it truly is one:
        //   - offset 0 is always the start of the first line, OR
        //   - the byte immediately before it is '\n' (previous line ended cleanly).
        // When neither holds, the appended bytes continue an existing partial
        // line, so we must NOT create a new offset entry here.
        let is_line_start = if from_offset == 0 {
            true
        } else {
            // Peek at the byte before from_offset; fall back to pushing (old
            // behaviour) if the seek/read fails for any reason.
            let mut byte = [0u8; 1];
            let peek = file
                .seek(SeekFrom::Start(from_offset - 1))
                .and_then(|_| file.read_exact(&mut byte));
            match peek {
                Ok(()) => byte[0] == b'\n',
                Err(_) => true, // graceful fallback: keep old behaviour
            }
        };
        // Restore position to from_offset after the optional peek.
        if from_offset > 0 {
            file.seek(SeekFrom::Start(from_offset))
                .map_err(|e| AppError::new(ErrorKind::Io, e.to_string()))?;
        }
        if is_line_start {
            self.offsets.push(from_offset);
        }

        let mut pos = from_offset;
        let mut buf = [0u8; 65536];
        loop {
            let n = file
                .read(&mut buf)
                .map_err(|e| AppError::new(ErrorKind::Io, e.to_string()))?;
            if n == 0 {
                break;
            }
            for &b in &buf[..n] {
                if b == b'\n' {
                    let next_line_start = pos + 1;
                    // Only push if there are more bytes after this newline
                    // (i.e., we don't create a phantom empty line at EOF).
                    // We'll fix this up after the loop by checking actual file length.
                    self.offsets.push(next_line_start);
                }
                pos += 1;
            }
        }

        self.indexed_len = pos;

        // Remove a trailing phantom offset that points exactly at EOF (or beyond).
        // This happens when the last byte of the file is '\n'.
        while self.offsets.last().copied().unwrap_or(0) >= self.indexed_len
            && self.offsets.len() > 1
        {
            self.offsets.pop();
        }

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Free search helper (no lock held during the scan)
// ---------------------------------------------------------------------------

/// Stream `path` from disk and return 0-based indices of lines matching `query`.
///
/// Extracted from `LineIndex::search` so that `log_search` can drop the
/// `LogIndexState` mutex guard before calling this (file streaming can take
/// seconds on large files — holding the guard would block concurrent
/// `log_window` / scroll calls).
pub fn search_file(path: &str, query: &str, case_sensitive: bool, regex: bool) -> Vec<usize> {
    let pattern = if regex {
        query.to_owned()
    } else {
        regex::escape(query)
    };
    let re = match RegexBuilder::new(&pattern)
        .case_insensitive(!case_sensitive)
        .build()
    {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };

    let file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return Vec::new(),
    };
    let reader = BufReader::new(file);
    let mut matches = Vec::new();
    for (i, line) in reader.lines().enumerate() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        if re.is_match(&line) {
            matches.push(i);
        }
    }
    matches
}

// ---------------------------------------------------------------------------
// Managed state + Tauri commands
// ---------------------------------------------------------------------------

pub struct LogIndexState(pub Mutex<HashMap<String, LineIndex>>);

impl Default for LogIndexState {
    fn default() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

/// Open (or re-index) a log file and return its line count.
#[tauri::command]
pub fn log_open(
    path: String,
    state: tauri::State<LogIndexState>,
) -> Result<usize, AppError> {
    let idx = LineIndex::build(&path)?;
    let count = idx.line_count();
    state
        .0
        .lock()
        .map_err(|_| AppError::new(ErrorKind::Io, "lock poisoned"))?
        .insert(path, idx);
    Ok(count)
}

/// Return `count` lines starting at 0-based line `start` for an already-opened file.
#[tauri::command]
pub fn log_window(
    path: String,
    start: usize,
    count: usize,
    state: tauri::State<LogIndexState>,
) -> Result<Vec<String>, AppError> {
    let guard = state
        .0
        .lock()
        .map_err(|_| AppError::new(ErrorKind::Io, "lock poisoned"))?;
    let idx = guard
        .get(&path)
        .ok_or_else(|| AppError::new(ErrorKind::NotFound, format!("File not open: {path}")))?;
    Ok(idx.window(start, count))
}

/// Search an already-opened file and return 0-based matching line indices.
///
/// The `LogIndexState` mutex is locked only to verify the file is open and to
/// clone its path, then immediately released.  The actual file scan runs
/// lock-free so concurrent `log_window` (scroll) calls are not blocked.
#[tauri::command]
pub fn log_search(
    path: String,
    query: String,
    case_sensitive: bool,
    regex: bool,
    state: tauri::State<LogIndexState>,
) -> Result<Vec<usize>, AppError> {
    // Lock → verify open → clone path → drop guard.
    let file_path = {
        let guard = state
            .0
            .lock()
            .map_err(|_| AppError::new(ErrorKind::Io, "lock poisoned"))?;
        guard
            .get(&path)
            .ok_or_else(|| AppError::new(ErrorKind::NotFound, format!("File not open: {path}")))?
            .path
            .clone()
        // guard is dropped here
    };
    Ok(search_file(&file_path, &query, case_sensitive, regex))
}

/// Return the byte length of `path` without reading its content.
/// Used by the frontend to decide between windowed and in-memory rendering.
#[tauri::command]
pub fn file_size(path: String) -> Result<u64, AppError> {
    std::fs::metadata(&path)
        .map(|m| m.len())
        .map_err(|e| AppError::new(ErrorKind::NotFound, e.to_string()))
}

// ---------------------------------------------------------------------------
// Tests (from task brief)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str, body: &str) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(name);
        std::fs::write(&p, body).unwrap();
        p
    }

    #[test]
    fn indexes_windows_and_counts() {
        let p = tmp("li_a.log", "l0\nl1\nl2\nl3\n");
        let idx = LineIndex::build(p.to_string_lossy().as_ref()).unwrap();
        assert_eq!(idx.line_count(), 4);
        assert_eq!(idx.window(1, 2), vec!["l1".to_string(), "l2".to_string()]);
        assert_eq!(idx.window(3, 10), vec!["l3".to_string()]); // clamps past end
    }

    #[test]
    fn search_returns_line_numbers() {
        let p = tmp("li_b.log", "alpha\nBETA\ngamma beta\n");
        let idx = LineIndex::build(p.to_string_lossy().as_ref()).unwrap();
        assert_eq!(idx.search("beta", false, false), vec![1, 2]); // case-insensitive
        assert_eq!(idx.search("beta", true, false), vec![2]); // case-sensitive
        assert_eq!(idx.search("a.*a", false, true), vec![0, 2]); // regex
    }

    #[test]
    fn extend_picks_up_appended_lines() {
        let p = tmp("li_c.log", "one\n");
        let mut idx = LineIndex::build(p.to_string_lossy().as_ref()).unwrap();
        assert_eq!(idx.line_count(), 1);
        std::fs::write(&p, "one\ntwo\nthree\n").unwrap();
        idx.extend().unwrap();
        assert_eq!(idx.line_count(), 3);
        assert_eq!(
            idx.window(1, 2),
            vec!["two".to_string(), "three".to_string()]
        );
    }

    #[test]
    fn extend_after_no_trailing_newline_does_not_split_the_last_line() {
        let p = std::env::temp_dir().join("li_d.log");
        std::fs::write(&p, "a\nb").unwrap(); // last line "b" has NO trailing newline
        let mut idx = LineIndex::build(p.to_string_lossy().as_ref()).unwrap();
        assert_eq!(idx.line_count(), 2);
        // The partial line "b" is completed and more lines appended:
        std::fs::write(&p, "a\nbcont\nc\n").unwrap();
        idx.extend().unwrap();
        assert_eq!(idx.line_count(), 3);
        assert_eq!(idx.window(1, 1), vec!["bcont".to_string()]); // not "b" + phantom
        assert_eq!(idx.window(2, 1), vec!["c".to_string()]);
    }
}
