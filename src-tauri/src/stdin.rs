use std::collections::VecDeque;
use std::io::{BufRead, IsTerminal};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// The most recent piped-stdin lines, capped. Shared between the reader thread
/// (which appends) and the `stdin_lines` command (which the frontend pulls).
pub type StdinBuffer = Arc<Mutex<VecDeque<String>>>;

const MAX_LINES: usize = 10_000;

pub fn new_buffer() -> StdinBuffer {
    Arc::new(Mutex::new(VecDeque::new()))
}

/// Decode one `read_until` chunk into a line: strip a trailing `\n` (and `\r`),
/// and decode UTF-8 leniently so a stray non-UTF8 byte (binary noise in a log)
/// becomes a replacement char instead of aborting the whole stream.
fn decode_line(buf: &[u8]) -> String {
    let mut end = buf.len();
    if end > 0 && buf[end - 1] == b'\n' {
        end -= 1;
        if end > 0 && buf[end - 1] == b'\r' {
            end -= 1;
        }
    }
    String::from_utf8_lossy(&buf[..end]).into_owned()
}

/// If stdin is piped (not a TTY), read it on a background thread into the shared
/// buffer (capped) and emit a lightweight `stdin-changed` signal after each
/// batch. No-op when stdin is a terminal — so `lucent` with no pipe and the
/// macOS .app double-click are unaffected.
///
/// The buffer (not the event payload) is the source of truth: the frontend
/// pulls the full snapshot via `stdin_lines` on startup AND on each
/// `stdin-changed`, so lines produced before the webview registers its listener
/// are never lost (no event-before-listener race).
pub fn spawn_reader(app: AppHandle, buffer: StdinBuffer) {
    if std::io::stdin().is_terminal() {
        return;
    }
    let (tx, rx) = mpsc::channel::<String>();

    // Reader thread: blocking reads off stdin, decoded leniently so a stray
    // non-UTF8 byte becomes a replacement char rather than permanently halting
    // the stream (logs can contain binary noise). Exits on EOF or a real I/O error.
    std::thread::spawn(move || {
        let stdin = std::io::stdin();
        let mut lock = stdin.lock();
        let mut buf = Vec::new();
        loop {
            buf.clear();
            match lock.read_until(b'\n', &mut buf) {
                Ok(0) => break, // EOF
                Ok(_) => {
                    if tx.send(decode_line(&buf)).is_err() {
                        break; // receiver gone
                    }
                }
                Err(_) => break, // real I/O error
            }
        }
    });

    // Flush thread: coalesce bursts (~50ms), append to the capped buffer, then
    // emit one `stdin-changed` signal so the frontend re-pulls the snapshot.
    std::thread::spawn(move || {
        while let Ok(first) = rx.recv() {
            let mut batch = vec![first];
            while let Ok(l) = rx.try_recv() {
                batch.push(l);
            }
            std::thread::sleep(Duration::from_millis(50));
            while let Ok(l) = rx.try_recv() {
                batch.push(l);
            }
            if let Ok(mut buf) = buffer.lock() {
                for l in batch {
                    buf.push_back(l);
                }
                while buf.len() > MAX_LINES {
                    buf.pop_front();
                }
            }
            let _ = app.emit("stdin-changed", ());
        }
    });
}

/// Return the current stdin buffer snapshot (oldest→newest, capped).
#[tauri::command]
pub fn stdin_lines(buffer: tauri::State<StdinBuffer>) -> Vec<String> {
    buffer
        .lock()
        .map(|b| b.iter().cloned().collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::decode_line;

    #[test]
    fn decode_line_strips_newlines_and_decodes_leniently() {
        assert_eq!(decode_line(b"hello\n"), "hello");
        assert_eq!(decode_line(b"hello\r\n"), "hello"); // CRLF
        assert_eq!(decode_line(b"no newline"), "no newline");
        assert_eq!(decode_line(b""), "");
        // A non-UTF8 byte becomes the replacement char — never panics/halts.
        let s = decode_line(&[b'a', 0xff, b'b', b'\n']);
        assert!(s.starts_with('a') && s.ends_with('b'));
        assert!(s.contains('\u{FFFD}'));
    }
}
