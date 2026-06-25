import { describe, it, expect } from "vitest";
import { detectLevel } from "../src/logs/level";

describe("detectLevel", () => {
  it("flags error and fatal as error", () => {
    expect(detectLevel("[12:00] ERROR boom")).toBe("error");
    expect(detectLevel("FATAL out of memory")).toBe("error");
    expect(detectLevel("CRITICAL disk full")).toBe("error");
  });
  it("flags abbreviated syslog severities as error", () => {
    expect(detectLevel("kernel: err: disk failure")).toBe("error");
    expect(detectLevel("sshd crit: auth subsystem down")).toBe("error");
    expect(detectLevel("EMERG system unusable")).toBe("error");
    // abbreviations must be whole words — not matched inside other words
    expect(detectLevel("the terror subsided")).toBe("none");
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
