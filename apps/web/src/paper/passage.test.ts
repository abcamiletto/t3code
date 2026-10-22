import { describe, expect, it } from "vite-plus/test";

import { matchPassage, type TextRun } from "./passage";

// A paragraph typeset on three lines, each one text run with 5 points per character.
const line = (y: number, text: string): TextRun => ({
  page: 1,
  text,
  x: 100,
  y,
  width: text.length * 5,
  height: 10,
});
const runs = [
  line(100, "Human hands grasp objects of varying sizes. Charac-"),
  line(112, "ter animation and robotics depend on this variety [3, 4]. Ani-"),
  line(124, "mation needs plausible grasps."),
];
const region = [{ page: 1, x: 100, y: 95, width: 400, height: 45 }];

describe("matchPassage", () => {
  it("narrows a paragraph to one sentence across a hyphenated line break", () => {
    const boxes = matchPassage(
      runs,
      region,
      "Character animation and robotics depend on this variety~\\cite{a,b}.",
    );
    expect(boxes).toEqual([
      { page: 1, x: 100 + 44 * 5, y: 100, width: 7 * 5, height: 10 },
      { page: 1, x: 100, y: 112, width: 49 * 5, height: 10 },
    ]);
  });

  it("ignores text outside the SyncTeX region and returns null without plain words", () => {
    expect(
      matchPassage(runs, [{ ...region[0]!, y: 300 }], "Human hands grasp objects."),
    ).toBeNull();
    expect(matchPassage(runs, region, "$x^2$ \\cite{a}")).toBeNull();
  });
});
