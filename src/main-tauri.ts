import { tauriAdapter } from "./platform/tauri";
import { initApp } from "./main";
import { checkForUpdates } from "./updater";

initApp(tauriAdapter);

// Attach the native shell first, then check without delaying startup. Network
// failures are non-fatal; checkForUpdates logs them and leaves the app usable.
setTimeout(() => { void checkForUpdates(); }, 1_000);
