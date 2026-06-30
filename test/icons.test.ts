import { describe, it, expect, beforeEach } from "vitest";
import { injectSprite, setButtonIcon, iconMarkup, ICON_PATHS, SPRITE_ID } from "../src/icons";

function makeIconButton(iconId: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.innerHTML = iconMarkup(iconId);
  return b;
}

describe("icons", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("injects the sprite once (idempotent)", () => {
    injectSprite(document);
    injectSprite(document);
    expect(document.querySelectorAll(`#${SPRITE_ID}`).length).toBe(1);
    // every declared icon becomes a <symbol>
    const symbols = document.querySelectorAll(`#${SPRITE_ID} symbol`);
    expect(symbols.length).toBe(Object.keys(ICON_PATHS).length);
    expect(document.getElementById("ic-folder")).not.toBeNull();
  });

  it("iconMarkup references a symbol by id", () => {
    const b = makeIconButton("ic-eye");
    const use = b.querySelector("use");
    expect(use?.getAttribute("href")).toBe("#ic-eye");
    expect(b.querySelector("svg.ic")).not.toBeNull();
  });

  it("setButtonIcon swaps the symbol without blanking the button", () => {
    const b = makeIconButton("ic-eye");
    setButtonIcon(b, "ic-code", "Raw");
    // The <svg> must survive — this is the exact regression we guard against.
    expect(b.querySelector("svg.ic")).not.toBeNull();
    expect(b.querySelector("use")?.getAttribute("href")).toBe("#ic-code");
    expect(b.getAttribute("aria-label")).toBe("Raw");
    expect(b.getAttribute("data-tip")).toBe("Raw");
  });

  it("every icon id resolves to non-empty path markup", () => {
    for (const [id, path] of Object.entries(ICON_PATHS)) {
      expect(path.length, id).toBeGreaterThan(0);
    }
  });
});
