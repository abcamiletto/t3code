import { describe, expect, it } from "vite-plus/test";

import { backwardSearch, forwardSearch, parseSyncTex } from "./synctex.ts";

// One page with two typeset lines (1 pt = 65536 sp; 72.27 pt = 72 bp). The first line holds
// source lines 3 and 4, the second line 4 and 5; edge glue carries the paragraph's last line.
const pt = (value: number) => Math.round(value * 65536 * (72.27 / 72));
const line = (y: number, marks: ReadonlyArray<readonly [string, number, number]>) => [
  `(1,5:${pt(100)},${pt(y)}:${pt(300)},${pt(8)},${pt(2)}`,
  `g1,5:${pt(100)},${pt(y)}`,
  ...marks.map(([kind, source, x]) => `${kind}1,${source}:${pt(x)},${pt(y)}`),
  `g1,5:${pt(400)},${pt(y)}`,
  ")",
];
const fixture = [
  "SyncTeX Version:1",
  "Input:1:./main.tex",
  "Input:2:/texmf/article.cls",
  "Output:pdf",
  "Magnification:1000",
  "Unit:1",
  "X Offset:0",
  "Y Offset:0",
  "Content:",
  "{1",
  `[1,1:0,0:${pt(600)},${pt(800)},0`,
  ...line(100, [
    ["x", 3, 100],
    ["g", 3, 180],
    ["k", 4, 250],
    ["g", 4, 320],
  ]),
  ...line(120, [
    ["x", 4, 100],
    ["g", 5, 260],
  ]),
  "]",
  "}1",
].join("\n");
const synctex = parseSyncTex(fixture, (input) =>
  input.startsWith("/") ? input : `/paper/${input.slice(2)}`,
);

describe("forwardSearch", () => {
  it("returns one box per typeset line, clipped where other source lines share it", () => {
    const boxes = forwardSearch(synctex, "/paper/main.tex", 4, 4).map((box) => ({
      ...box,
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.round(box.width),
      height: Math.round(box.height),
    }));
    expect(boxes).toEqual([
      { page: 1, x: 250, y: 92, width: 150, height: 10 },
      { page: 1, x: 100, y: 112, width: 160, height: 10 },
    ]);
  });

  it("ignores paragraph edge glue, which carries the paragraph's last source line", () => {
    expect(forwardSearch(synctex, "/paper/main.tex", 5, 5)).toHaveLength(1);
  });

  it("finds nothing for files the document does not read", () => {
    expect(forwardSearch(synctex, "/paper/other.tex", 1, 99)).toEqual([]);
  });
});

describe("backwardSearch", () => {
  it("returns the source line of the nearest mark at or before the point", () => {
    expect(backwardSearch(synctex, { page: 1, x: 200, y: 98 })).toEqual({
      file: "/paper/main.tex",
      line: 3,
    });
    expect(backwardSearch(synctex, { page: 1, x: 300, y: 98 })).toEqual({
      file: "/paper/main.tex",
      line: 4,
    });
  });

  it("picks the nearest line for a point between lines", () => {
    expect(backwardSearch(synctex, { page: 1, x: 120, y: 111 })?.line).toBe(4);
  });

  it("finds nothing on a page without text", () => {
    expect(backwardSearch(synctex, { page: 2, x: 100, y: 100 })).toBeUndefined();
  });
});
