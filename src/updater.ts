import { check } from "@tauri-apps/plugin-updater";
import { confirm, message } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";

type AvailableUpdate = NonNullable<Awaited<ReturnType<typeof check>>>;

export interface UpdaterDependencies {
  check: () => Promise<AvailableUpdate | null>;
  confirm: typeof confirm;
  message: typeof message;
  relaunch: typeof relaunch;
}

const nativeDependencies: UpdaterDependencies = {
  check: () => check({ timeout: 15_000 }),
  confirm,
  message,
  relaunch,
};

/** Check once, ask before downloading, then install and restart the app. */
export async function checkForUpdates(
  deps: UpdaterDependencies = nativeDependencies,
): Promise<"current" | "deferred" | "installed" | "failed"> {
  let installationStarted = false;
  try {
    const update = await deps.check();
    if (!update) return "current";

    const accepted = await deps.confirm(
      `Lucent ${update.version} is available (currently ${update.currentVersion}). Install it now?`,
      {
        title: "Update available",
        kind: "info",
        okLabel: "Install update",
        cancelLabel: "Later",
      },
    );
    if (!accepted) {
      await update.close();
      return "deferred";
    }

    installationStarted = true;
    await update.downloadAndInstall();
    await deps.relaunch();
    return "installed";
  } catch (error) {
    console.warn("Lucent update check failed", error);
    // A failed background check should not interrupt startup. Once the user has
    // accepted an update, however, surface installation failures explicitly.
    // The generic wording also avoids leaking endpoint details into the UI.
    if (installationStarted) {
      await deps.message("The update could not be installed. Please try again later.", {
        title: "Update failed",
        kind: "error",
      });
    }
    return "failed";
  }
}
