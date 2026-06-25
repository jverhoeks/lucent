//! Native PDF export.
//!
//! On macOS we capture the live webview with `WKWebView.createPDF`. The frontend
//! first restructures the DOM (hides chrome, lets the body grow to the full
//! document height) so the capture is the clean document rather than the app
//! window. On other platforms this command reports `unsupported_platform` and the
//! frontend falls back to browser-based printing.

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn export_pdf_native(window: tauri::WebviewWindow, dest: String) -> Result<(), String> {
    use block2::RcBlock;
    use objc2::MainThreadMarker;
    use objc2_foundation::{NSData, NSError};
    use objc2_web_kit::{WKPDFConfiguration, WKWebView};
    use std::sync::mpsc;

    let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();

    // Reset zoom so the capture isn't scaled by the user's current zoom level;
    // combined with the fixed-width `.exporting` layout this yields a consistent
    // A4-width PDF regardless of window size.
    let _ = window.set_zoom(1.0);

    window
        .with_webview(move |pw| {
            // SAFETY: `pw.inner()` is the `WKWebView` backing this window's webview,
            // and `with_webview` runs this closure on the main thread.
            unsafe {
                let mtm = match MainThreadMarker::new() {
                    Some(m) => m,
                    None => {
                        let _ = tx.send(Err("createPDF must run on the main thread".into()));
                        return;
                    }
                };
                let wk: &WKWebView = &*(pw.inner() as *const WKWebView);
                let config = WKPDFConfiguration::new(mtm);
                let handler = RcBlock::new(move |data: *mut NSData, err: *mut NSError| {
                    if let Some(err) = err.as_ref() {
                        let _ = tx.send(Err(err.localizedDescription().to_string()));
                        return;
                    }
                    match data.as_ref() {
                        Some(data) => {
                            let _ = tx.send(Ok(data.to_vec()));
                        }
                        None => {
                            let _ = tx.send(Err("createPDF returned no data".into()));
                        }
                    }
                });
                wk.createPDFWithConfiguration_completionHandler(Some(&config), &handler);
            }
        })
        .map_err(|e| e.to_string())?;

    // The completion handler runs on the main thread; this command runs on a
    // worker thread, so blocking here does not stall the handler.
    let bytes = rx.recv().map_err(|e| e.to_string())??;
    std::fs::write(&dest, bytes).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn export_pdf_native(_dest: String) -> Result<(), String> {
    Err("unsupported_platform".into())
}
