import { describe, expect, it, vi } from "vitest";
import { webAdapter } from "../src/platform/web";

describe("webAdapter", () => {
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
});
