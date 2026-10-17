import { expect, it } from "vite-plus/test";
import { backwardSearch, forwardSearch, parseSyncTex } from "./synctex.ts";

const fixture = `SyncTeX Version:1
Input:1:/paper/main.tex
Input:2:sections/results.tex
Output:pdf
Magnification:1000
Unit:1
X Offset:0
Y Offset:0
Content:
{1
(1,5:655360,1310720:1966080,655360,131072
h1,3:655360,1310720:655360,0,0
g1,3:1966080,1310720
g1,4:2621440,1310720
)
}1
{2
(2,8:1310720,2621440:655360,655360,0
g2,7:1966080,2621440
)
}2
Postamble:
Count:10
`;
const bp = 72 / 72.27;

it("maps leaf source lines using their enclosing box height, and merges each rendered row", () => {
  const sync = parseSyncTex(fixture, "/paper");
  const boxes = forwardSearch(sync, "main.tex", 3, 3);
  expect(boxes).toHaveLength(1);
  expect(boxes[0]!.x).toBeCloseTo(20 * bp);
  expect(boxes[0]!.y).toBeCloseTo(10 * bp);
  expect(boxes[0]!.width).toBeCloseTo(10 * bp);
  expect(boxes[0]!.height).toBeCloseTo(12 * bp);
  expect(forwardSearch(sync, "main.tex", 3, 4)[0]!.width).toBeCloseTo(20 * bp);
  expect(forwardSearch(sync, "main.tex", 8, 9)).toEqual([]);
});

it("backward search chooses the nearest source on the selected page", () => {
  const sync = parseSyncTex(fixture, "/paper");
  expect(backwardSearch(sync, 1, 15, 15)).toEqual({ file: "main.tex", line: 3 });
  expect(backwardSearch(sync, 1, 36, 15)).toEqual({ file: "main.tex", line: 4 });
  expect(backwardSearch(sync, 2, 25, 35)).toEqual({ file: "sections/results.tex", line: 7 });
  expect(backwardSearch(sync, 3, 0, 0)).toBeUndefined();
});

it("applies unit, magnification and offsets in scaled TeX points, converting to PDF points", () => {
  const sync = parseSyncTex(
    fixture
      .replace("Unit:1", "Unit:2")
      .replace("Magnification:1000", "Magnification:1200")
      .replace("X Offset:0", "X Offset:65536")
      .replace("Y Offset:0", "Y Offset:131072"),
    "/paper",
  );
  const [box] = forwardSearch(sync, "main.tex", 3, 3);
  expect(box!.x).toBeCloseTo((20 * 2 * 1.2 + 2) * bp);
  expect(box!.y).toBeCloseTo((10 * 2 * 1.2 + 4) * bp);
  expect(box!.width).toBeCloseTo(10 * 2 * 1.2 * bp);
});

it("locates a single word when SyncTeX records only an indent and a trailing kern", () => {
  const singleWord = fixture.replace(
    "g1,3:1966080,1310720\ng1,4:2621440,1310720",
    "k1,4:2621440,1310720:655360",
  );
  const sync = parseSyncTex(singleWord, "/paper");
  const [box] = forwardSearch(sync, "main.tex", 3, 3);
  expect(box!.x).toBeCloseTo(20 * bp);
  expect(box!.width).toBeCloseTo(10 * bp);
  expect(backwardSearch(sync, 1, 25 * bp, 15 * bp)).toEqual({ file: "main.tex", line: 3 });
});
