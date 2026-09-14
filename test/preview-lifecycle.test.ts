import { afterEach, describe, expect, it, vi } from "vitest";
import { PreviewLifecycle } from "../src/preview-lifecycle";

describe("PreviewLifecycle", () => {
  afterEach(() => vi.useRealTimers());

  it("runs only the latest scheduled preview generation", async () => {
    vi.useFakeTimers();
    const lifecycle = new PreviewLifecycle();
    const rendered: string[] = [];
    const stale = lifecycle.begin();
    lifecycle.schedule(stale, () => rendered.push("stale"));
    const current = lifecycle.begin();
    lifecycle.schedule(current, () => rendered.push("current"));
    await vi.runAllTimersAsync();
    expect(rendered).toEqual(["current"]);
    expect(lifecycle.isCurrent(stale)).toBe(false);
    expect(lifecycle.isCurrent(current)).toBe(true);
  });
});
