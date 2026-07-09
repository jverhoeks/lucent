import { beforeEach, describe, expect, it, vi } from "vitest";
import { copyMermaidLucid } from "../src/mermaid-export";

function parseSvg(markup: string): SVGSVGElement {
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  return doc.documentElement as unknown as SVGSVGElement;
}

describe("mermaid export clipboard helpers", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(async () => {}),
      },
    });
  });

  it("copies Lucidchart-compatible mxGraph XML as plain text", async () => {
    const svg = parseSvg(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <g class="edgePaths">
          <path data-id="L_A_B_0" d="M100,50L300,50" marker-end="url(#arrow)"/>
        </g>
        <g class="nodes">
          <g class="node" id="mermaid-1-flowchart-A-0" transform="translate(100,50)">
            <rect class="label-container" x="-40" y="-20" width="80" height="40"/>
            <text>Alpha</text>
          </g>
          <g class="node" id="mermaid-1-flowchart-B-0" transform="translate(300,50)">
            <rect class="label-container" x="-40" y="-20" width="80" height="40"/>
            <text>Beta</text>
          </g>
        </g>
      </svg>
    `);

    await copyMermaidLucid(svg);

    expect(navigator.clipboard.writeText).toHaveBeenCalledOnce();
    const xml = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0];
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    expect(doc.querySelector("mxGraphModel")).toBeTruthy();
    expect(doc.querySelectorAll('mxCell[vertex="1"]')).toHaveLength(2);
    expect(doc.querySelector('mxCell[edge="1"]')?.getAttribute("endArrow")).toBeNull();
    expect(doc.querySelector('mxCell[edge="1"]')?.getAttribute("style")).toContain("endArrow=classic");
  });
});
