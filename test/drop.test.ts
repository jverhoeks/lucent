import { describe, expect, it, vi } from "vitest";
import { collectTextDropPaths } from "../src/main";

describe("collectTextDropPaths", () => {
  it("preserves root order and counts rejected and unreadable candidates", async () => {
    const files: Record<string, string[]> = {
      "/first": ["/first/a.md", "/first/mystery", "/first/image.bin"],
      "/second": ["/second/b.txt"],
    };
    const adapter = {
      listViewableRecursive: vi.fn(async (path: string) => {
        if (path === "/denied") throw new Error("permission denied");
        return files[path] ?? [];
      }),
      fileSize: vi.fn(async () => 100),
      probeIsText: vi.fn(async (path: string) => path.endsWith("mystery")),
    };

    const result = await collectTextDropPaths(["/first", "/denied", "/second"], adapter);

    expect(result).toEqual({
      paths: ["/first/a.md", "/first/mystery", "/second/b.txt"],
      skipped: 2,
    });
  });

  it("does not probe unknown files larger than one MiB", async () => {
    const probeIsText = vi.fn(async () => true);
    const result = await collectTextDropPaths(["/large"], {
      listViewableRecursive: async () => ["/large/no-extension"],
      fileSize: async () => 1_048_577,
      probeIsText,
    });

    expect(result).toEqual({ paths: [], skipped: 1 });
    expect(probeIsText).not.toHaveBeenCalled();
  });
});
