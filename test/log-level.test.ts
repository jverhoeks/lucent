import { describe, it, expect } from "vitest";
import { detectLevel } from "../src/logs/level";

describe("detectLevel", () => {
  it("flags error and fatal as error", () => {
    expect(detectLevel("[12:00] ERROR boom")).toBe("error");
    expect(detectLevel("FATAL out of memory")).toBe("error");
    expect(detectLevel("CRITICAL disk full")).toBe("error");
  });
  it("flags warnings", () => {
    expect(detectLevel("WARN high mem")).toBe("warn");
    expect(detectLevel("[x] WARNING slow")).toBe("warn");
  });
  it("flags info and debug/trace", () => {
    expect(detectLevel("INFO started")).toBe("info");
    expect(detectLevel("DEBUG route resolved")).toBe("debug");
    expect(detectLevel("TRACE webhook")).toBe("debug");
  });
  it("error wins when multiple levels appear", () => {
    expect(detectLevel("INFO retry after ERROR")).toBe("error");
  });
  it("returns none when no level token", () => {
    expect(detectLevel("just a plain line")).toBe("none");
  });
});
