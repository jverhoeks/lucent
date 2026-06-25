use std::io::{BufRead, IsTerminal};
use std::sync::mpsc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// If stdin is piped (not a TTY), stream its lines to the frontend as batched
/// `stdin-lines` events. No-op when stdin is a terminal (don't consume it) — so
/// `lucent` with no pipe, and the macOS .app double-click, are unaffected.
pub fn spawn_reader(app: AppHandle) {
    if std::io::stdin().is_terminal() {
        return;
    }
    let (tx, rx) = mpsc::channel::<String>();

    // Reader thread: blocking line reads off stdin, forwarded to the channel.
    std::thread::spawn(move || {
        let stdin = std::io::stdin();
        for line in stdin.lock().lines() {
            match line {
                Ok(l) => {
                    if tx.send(l).is_err() {
                        break; // receiver gone
                    }
                }
                Err(_) => break, // non-UTF8 / closed
            }
        }
    });

    // Flush thread: coalesce bursts into one event every ~50ms (or per idle gap),
    // so a fast producer doesn't trigger an IPC event per line.
    std::thread::spawn(move || {
        // Block for the first line of each batch; exit when the reader is done.
        while let Ok(first) = rx.recv() {
            let mut batch = vec![first];
            // Drain whatever else is immediately available, then a short settle.
            while let Ok(l) = rx.try_recv() {
                batch.push(l);
            }
            std::thread::sleep(Duration::from_millis(50));
            while let Ok(l) = rx.try_recv() {
                batch.push(l);
            }
            let _ = app.emit("stdin-lines", batch);
        }
    });
}
