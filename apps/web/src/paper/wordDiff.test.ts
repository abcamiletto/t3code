import { describe, expect, it } from "vite-plus/test";

import { wordDiff } from "./wordDiff";

describe("wordDiff", () => {
  it("marks replaced words and keeps the shared text", () => {
    expect(wordDiff("An original sentence.", "A clearer sentence.")).toEqual([
      { kind: "removed", text: "An original" },
      { kind: "added", text: "A clearer" },
      { kind: "same", text: " sentence." },
    ]);
  });
});

describe("wordDiff deletions", () => {
  it("shows a removed passage as one deletion", () => {
    expect(wordDiff("Keep this. Drop that.", "Keep this.")).toEqual([
      { kind: "same", text: "Keep this." },
      { kind: "removed", text: " Drop that." },
    ]);
  });
});
