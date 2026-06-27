use crate::error::{AppError, ErrorKind};
use memmap2::Mmap;
use regex::RegexBuilder;
use std::collections::HashMap;
use std::io::BufRead;
use std::path::Path;
use std::sync::Mutex;

/// Byte-offset index for a log file.
///
/// Each entry in `offsets` is the byte position of the start of that line.
/// Uses memory-mapped I/O for fast scanning and window reads.
/// Persists the offset map to a `.lidx` sidecar so re-opening a large file
/// reuses the previously computed index.
pub struct LineIndex {
    path: String,
    offsets: Vec<u64>,
    indexed_len: u64,
}

// ---------------------------------------------------------------------------
// Index building + scanning (mmap-based)
// ---------------------------------------------------------------------------

impl LineIndex {
    /// Scan `path` from byte 0 and build a fresh index.
    ///
    /// Attempts to load a previously-persisted sidecar (`.lidx`) first; if the
    /// file has grown since the sidecar was written, the remaining bytes are
    /// scanned incrementally.  The resulting index is always re-persisted.
    pub fn build(path: &str) -> Result<Self, AppError> {
        let mut idx = LineIndex {
            path: path.to_owned(),
            offsets: Vec::new(),
            indexed_len: 0,
        };
        if !idx.try_load() {
            idx.scan_from(0)?;
        } else {
            let current_len = std::fs::metadata(&idx.path)
                .map(|m| m.len())
                .unwrap_or(0);
            if current_len > idx.indexed_len {
                idx.scan_from(idx.indexed_len)?;
            }
        }
        idx.save();
        Ok(idx)
    }

    pub fn line_count(&self) -> usize {
        self.offsets.len()
    }

    /// Return up to `count` lines starting at 0-based line `start`.
    ///
    /// Uses a memory-mapped slice of the file region so no intermediate buffer
    /// is needed.  Invalid UTF-8 bytes are replaced with U+FFFD.
    pub fn window(&self, start: usize, count: usize) -> Vec<String> {
        if start >= self.offsets.len() {
            return Vec::new();
        }
        let end = (start + count).min(self.offsets.len());
        let file = match std::fs::File::open(&self.path) {
            Ok(f) => f,
            Err(_) => return Vec::new(),
        };
        let mmap = match unsafe { Mmap::map(&file) } {
            Ok(m) => m,
            Err(_) => return Vec::new(),
        };

        let byte_start = self.offsets[start] as usize;
        let byte_end = if end < self.offsets.len() {
            self.offsets[end] as usize
        } else {
            mmap.len()
        };
        let slice = &mmap[byte_start..byte_end];

        let mut lines = Vec::with_capacity(end - start);
        let mut seg_start = 0usize;
        for (i, &b) in slice.iter().enumerate() {
            if b == b'\n' {
                let line = trim_cr(&slice[seg_start..i]);
                lines.push(String::from_utf8_lossy(line).into_owned());
                seg_start = i + 1;
            }
        }
        if seg_start < slice.len() {
            let line = trim_cr(&slice[seg_start..]);
            lines.push(String::from_utf8_lossy(line).into_owned());
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
    ///
    /// After a log file is appended to, call `extend()` to pick up the new
    /// lines without re-reading the whole file.
    pub fn extend(&mut self) -> Result<(), AppError> {
        let current_len = std::fs::metadata(&self.path)
            .map(|m| m.len())
            .map_err(|e| AppError::new(ErrorKind::Io, e.to_string()))?;
        if current_len > self.indexed_len {
            self.scan_from(self.indexed_len)?;
            self.save();
        }
        Ok(())
    }

    /// Scan the file starting at `from_offset` using mmap, appending
    /// discovered line-start offsets to `self.offsets`.
    fn scan_from(&mut self, from_offset: u64) -> Result<(), AppError> {
        let file = std::fs::File::open(&self.path)
            .map_err(|e| AppError::new(ErrorKind::NotFound, e.to_string()))?;
        let mmap =
            unsafe { Mmap::map(&file) }.map_err(|e| AppError::new(ErrorKind::Unreadable, e.to_string()))?;
        let file_len = mmap.len() as u64;

        // Push `from_offset` as a line-start only when it truly is one:
        //   - offset 0 is always the start of the first line, OR
        //   - the byte immediately before it is '\n' (previous line ended cleanly).
        let is_line_start = if from_offset == 0 {
            true
        } else if (from_offset as usize) <= mmap.len() {
            mmap[(from_offset - 1) as usize] == b'\n'
        } else {
            // Beyond EOF — nothing to scan.
            self.indexed_len = file_len;
            return Ok(());
        };

        if is_line_start {
            self.offsets.push(from_offset);
        }

        let bytes = &mmap[(from_offset as usize)..];
        for (i, &b) in bytes.iter().enumerate() {
            if b == b'\n' {
                self.offsets.push(from_offset + i as u64 + 1);
            }
        }

        self.indexed_len = file_len;

        // Remove a trailing phantom offset that points exactly at EOF (or beyond).
        while self.offsets.last().copied().unwrap_or(0) >= self.indexed_len
            && self.offsets.len() > 1
        {
            self.offsets.pop();
        }

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Persistence (S15): binary .lidx sidecar
// ---------------------------------------------------------------------------

impl LineIndex {
    /// Path to the sidecar file (hidden `.name.lidx` next to the log).
    fn sidecar_path(&self) -> std::path::PathBuf {
        let p = Path::new(&self.path);
        let parent = p.parent().unwrap_or(Path::new("."));
        let name = p.file_name().unwrap_or_default().to_string_lossy();
        parent.join(format!(".{}.lidx", name))
    }

    /// Serialize the index to a sidecar file.
    ///
    /// Format: `indexed_len` (u64 LE) | `count` (u64 LE) | `offsets` (count × u64 LE)
    fn save(&self) {
        let path = self.sidecar_path();
        let count = self.offsets.len() as u64;
        let mut buf = Vec::with_capacity(16 + (count as usize) * 8);
        buf.extend_from_slice(&self.indexed_len.to_le_bytes());
        buf.extend_from_slice(&count.to_le_bytes());
        for &offset in &self.offsets {
            buf.extend_from_slice(&offset.to_le_bytes());
        }
        let _ = std::fs::write(&path, buf);
    }

    /// Deserialize a sidecar if it exists and is newer than the log file.
    ///
    /// Returns `true` on success; the caller must still check whether the log
    /// has grown (via `indexed_len` vs current file length) and call
    /// `scan_from` if needed.
    fn try_load(&mut self) -> bool {
        let path = self.sidecar_path();
        if !path.exists() {
            return false;
        }
        // Only trust the sidecar if it's as new as the log file.
        let log_mtime = std::fs::metadata(&self.path)
            .and_then(|m| m.modified())
            .ok();
        let idx_mtime = std::fs::metadata(&path)
            .and_then(|m| m.modified())
            .ok();
        match (log_mtime, idx_mtime) {
            (Some(log_mt), Some(idx_mt)) if idx_mt < log_mt => return false,
            _ => {}
        }

        let data = match std::fs::read(&path) {
            Ok(d) => d,
            Err(_) => return false,
        };
        if data.len() < 16 {
            return false;
        }
        let indexed_len = u64::from_le_bytes(data[0..8].try_into().unwrap());
        let count = u64::from_le_bytes(data[8..16].try_into().unwrap());
        if data.len() != 16 + (count as usize) * 8 {
            return false;
        }
        let offsets: Vec<u64> = data[16..]
            .chunks_exact(8)
            .map(|c| u64::from_le_bytes(c.try_into().unwrap()))
            .collect();
        self.offsets = offsets;
        self.indexed_len = indexed_len;
        true
    }
}

// ---------------------------------------------------------------------------
// Free helpers
// ---------------------------------------------------------------------------

/// Strip a single trailing `\r` from a byte slice (if present).
fn trim_cr(buf: &[u8]) -> &[u8] {
    if buf.last() == Some(&b'\r') {
        &buf[..buf.len() - 1]
    } else {
        buf
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

    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return Vec::new(),
    };
    let reader = std::io::BufReader::new(file);
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
    };
    Ok(search_file(&file_path, &query, case_sensitive, regex))
}

/// Return the byte length of `path` without reading its content.
#[tauri::command]
pub fn file_size(path: String) -> Result<u64, AppError> {
    std::fs::metadata(&path)
        .map(|m| m.len())
        .map_err(|e| AppError::new(ErrorKind::NotFound, e.to_string()))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

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
        assert_eq!(idx.window(3, 10), vec!["l3".to_string()]);
    }

    #[test]
    fn search_returns_line_numbers() {
        let p = tmp("li_b.log", "alpha\nBETA\ngamma beta\n");
        let idx = LineIndex::build(p.to_string_lossy().as_ref()).unwrap();
        assert_eq!(idx.search("beta", false, false), vec![1, 2]);
        assert_eq!(idx.search("beta", true, false), vec![2]);
        assert_eq!(idx.search("a.*a", false, true), vec![0, 2]);
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
        std::fs::write(&p, "a\nb").unwrap();
        let mut idx = LineIndex::build(p.to_string_lossy().as_ref()).unwrap();
        assert_eq!(idx.line_count(), 2);
        std::fs::write(&p, "a\nbcont\nc\n").unwrap();
        idx.extend().unwrap();
        assert_eq!(idx.line_count(), 3);
        assert_eq!(idx.window(1, 1), vec!["bcont".to_string()]);
        assert_eq!(idx.window(2, 1), vec!["c".to_string()]);
    }

    #[test]
    fn persistence_round_trip() {
        // Build an index, make sure the sidecar exists, then build again and
        // verify it loads from the sidecar (same offsets, same count).
        let p = tmp("li_e.log", "a\nb\nc\n");
        // Clean any leftover sidecar.
        let sidecar = std::env::temp_dir().join(".li_e.log.lidx");
        let _ = std::fs::remove_file(&sidecar);

        let idx1 = LineIndex::build(p.to_string_lossy().as_ref()).unwrap();
        assert_eq!(idx1.line_count(), 3);
        assert!(sidecar.exists(), "sidecar should exist after build");

        // Re-build — expect loading from sidecar.
        let idx2 = LineIndex::build(p.to_string_lossy().as_ref()).unwrap();
        assert_eq!(idx2.line_count(), 3);
        assert_eq!(idx2.window(0, 3), vec!["a", "b", "c"]);
    }

    #[test]
    fn persistence_stale_sidecar_triggers_scan() {
        // Build index from a 3-line file, then append lines, then re-build
        // — should detect stale sidecar and extend incrementally.
        let p = tmp("li_f.log", "x\n");
        let sidecar = std::env::temp_dir().join(".li_f.log.lidx");
        let _ = std::fs::remove_file(&sidecar);

        LineIndex::build(p.to_string_lossy().as_ref()).unwrap();
        assert_eq!(std::fs::read(&sidecar).unwrap().len(), 16 + 1 * 8);

        // Append two more lines and re-open.
        let mut f = std::fs::OpenOptions::new().append(true).open(&p).unwrap();
        f.write_all(b"y\nz\n").unwrap();
        drop(f);

        let idx = LineIndex::build(p.to_string_lossy().as_ref()).unwrap();
        assert_eq!(idx.line_count(), 3);
        assert_eq!(idx.window(0, 3), vec!["x", "y", "z"]);
    }

    #[test]
    fn window_crlf_strips_trailing_cr() {
        let p = tmp("li_g.log", "a\r\nb\r\nc\r\n");
        let idx = LineIndex::build(p.to_string_lossy().as_ref()).unwrap();
        assert_eq!(idx.line_count(), 3);
        assert_eq!(idx.window(0, 3), vec!["a", "b", "c"]);
    }

    #[test]
    fn scan_from_handles_mid_line_extend() {
        // File with a partial line at the end; extend completes it.
        let p = std::env::temp_dir().join("li_h.log");
        std::fs::write(&p, "a\nb").unwrap();
        let mut idx = LineIndex::build(p.to_string_lossy().as_ref()).unwrap();
        assert_eq!(idx.line_count(), 2);
        assert_eq!(idx.window(1, 1), vec!["b"]);

        std::fs::write(&p, "a\nb\nc\n").unwrap();
        idx.extend().unwrap();
        assert_eq!(idx.line_count(), 3);
        assert_eq!(idx.window(1, 1), vec!["b"]);
        assert_eq!(idx.window(2, 1), vec!["c"]);
    }
}
