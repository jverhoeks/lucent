import { beforeEach, describe, expect, it, vi } from "vitest";
import { webAdapter } from "../src/platform/web";

describe("webAdapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:test") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  });

  it("attaches the file input before opening the browser picker", async () => {
    let clickedWhileAttached = false;
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) {
      clickedWhileAttached = document.body.contains(this);
      this.dispatchEvent(new Event("cancel"));
    });

    await expect(webAdapter.openDialog({ multiple: true })).resolves.toBeNull();

    expect(clickedWhileAttached).toBe(true);
    expect(document.querySelector('input[type="file"]')).toBeNull();
    clickSpy.mockRestore();
  });

  it("downloads text when an opened file has no writable handle", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await expect(webAdapter.saveTextFile("/opened/notes.md", "# durable"))
      .resolves.toBe("downloaded");

    expect(click).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  });

  it("preserves dropped folder paths and resolves a relative image", async () => {
    const markdown = new File(["![pixel](../assets/pixel.png)"], "readme.md", { type: "text/markdown" });
    const image = new File([new Uint8Array([1, 2, 3])], "pixel.png", { type: "image/png" });
    const fileEntry = (fullPath: string, file: File) => ({
      isFile: true,
      isDirectory: false,
      fullPath,
      file: (success: (value: File) => void) => success(file),
    });
    const children = [
      fileEntry("/project/docs/readme.md", markdown),
      fileEntry("/project/assets/pixel.png", image),
    ];
    let read = false;
    const root = {
      isFile: false,
      isDirectory: true,
      fullPath: "/project",
      createReader: () => ({
        readEntries: (success: (entries: typeof children) => void) => {
          success(read ? [] : children);
          read = true;
        },
      }),
    };

    const dropped = new Promise<string[]>((resolve) => {
      webAdapter.onDrop((event) => { if (event.type === "drop") resolve(event.paths); });
    });
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: { items: [{ webkitGetAsEntry: () => root }] },
    });
    document.dispatchEvent(event);

    const paths = await dropped;
    expect(paths).toEqual(["/opened/project/docs/readme.md"]);
    const assetPath = await webAdapter.resolveSibling(paths[0], "../assets/pixel.png");
    expect(assetPath).toBe("/opened/project/assets/pixel.png");
    await expect(webAdapter.localImageUrl!(paths[0], "../assets/pixel.png")).resolves.toBe("blob:test");
  });
});
