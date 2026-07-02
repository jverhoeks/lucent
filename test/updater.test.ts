import { describe, expect, it, vi } from "vitest";
import { checkForUpdates, type UpdaterDependencies } from "../src/updater";

function dependencies(update: any, accepted = true): UpdaterDependencies {
  return {
    check: vi.fn(async () => update),
    confirm: vi.fn(async () => accepted),
    message: vi.fn(async () => {}),
    relaunch: vi.fn(async () => {}),
  } as unknown as UpdaterDependencies;
}

describe("updater", () => {
  it("does nothing when the installed version is current", async () => {
    const deps = dependencies(null);
    await expect(checkForUpdates(deps)).resolves.toBe("current");
    expect(deps.confirm).not.toHaveBeenCalled();
  });

  it("closes a deferred update without downloading it", async () => {
    const update = {
      version: "0.4.0",
      currentVersion: "0.3.0",
      close: vi.fn(async () => {}),
      downloadAndInstall: vi.fn(async () => {}),
    };
    const deps = dependencies(update, false);

    await expect(checkForUpdates(deps)).resolves.toBe("deferred");
    expect(update.close).toHaveBeenCalledOnce();
    expect(update.downloadAndInstall).not.toHaveBeenCalled();
  });

  it("installs an accepted update and relaunches", async () => {
    const update = {
      version: "0.4.0",
      currentVersion: "0.3.0",
      close: vi.fn(async () => {}),
      downloadAndInstall: vi.fn(async () => {}),
    };
    const deps = dependencies(update);

    await expect(checkForUpdates(deps)).resolves.toBe("installed");
    expect(update.downloadAndInstall).toHaveBeenCalledOnce();
    expect(deps.relaunch).toHaveBeenCalledOnce();
  });

  it("reports an accepted update that fails to install", async () => {
    const update = {
      version: "0.4.0",
      currentVersion: "0.3.0",
      close: vi.fn(async () => {}),
      downloadAndInstall: vi.fn(async () => { throw new Error("offline"); }),
    };
    const deps = dependencies(update);

    await expect(checkForUpdates(deps)).resolves.toBe("failed");
    expect(deps.message).toHaveBeenCalledOnce();
    expect(deps.relaunch).not.toHaveBeenCalled();
  });
});
