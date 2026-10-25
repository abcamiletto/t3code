import type { PaperPdfBox } from "@t3tools/contracts";

/**
 * Reads SyncTeX without a separate executable. Inner position records retain source lines;
 * line boxes alone point to the end of a paragraph.
 */

interface LineBox {
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface Mark {
  readonly input: number;
  readonly line: number;
  readonly x: number;
  readonly box: LineBox;
}

export interface SyncTex {
  /** Absolute input paths by SyncTeX tag. */
  readonly inputs: ReadonlyMap<number, string>;
  readonly marks: readonly Mark[];
}

const RECORD =
  /^([[(hvrxkg$])(\d+),(\d+)(?:,-?\d+)?:(-?\d+),(-?\d+)(?::(-?\d+)(?:,(-?\d+),(-?\d+))?)?/;

export function parseSyncTex(text: string, resolveInput: (path: string) => string): SyncTex {
  const inputs = new Map<number, string>();
  const marks: Mark[] = [];
  // SyncTeX stores scaled points; PDF.js and the client use PDF points (1/72 in).
  let unit = 1;
  let magnification = 1000;
  const toPoints = (value: number) => (value * unit * magnification) / 1000 / 65536 / (72.27 / 72);
  let page = 0;
  // One entry per open box; `null` marks a vertical box, whose contents are not on a single line.
  const stack: Array<LineBox | null> = [];
  for (const raw of text.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.startsWith("Input:")) {
      const separator = line.indexOf(":", 6);
      inputs.set(Number(line.slice(6, separator)), resolveInput(line.slice(separator + 1)));
    } else if (line.startsWith("Unit:")) {
      unit = Number(line.slice(5)) || 1;
    } else if (line.startsWith("Magnification:")) {
      magnification = Number(line.slice(14)) || 1000;
    } else if (line.startsWith("{")) {
      page = Number(line.slice(1));
      stack.length = 0;
    } else if (line === "]" || line === ")") {
      stack.pop();
    } else {
      const record = RECORD.exec(line);
      if (record === null || page === 0) continue;
      const [, kind, input, sourceLine, h, v, w, height, depth] = record;
      const x = toPoints(Number(h));
      if (kind === "[") {
        stack.push(null);
      } else if (kind === "(") {
        const above = toPoints(Number(height ?? 0));
        stack.push({
          page,
          x,
          y: toPoints(Number(v)) - above,
          width: toPoints(Number(w ?? 0)),
          height: above + toPoints(Number(depth ?? 0)),
        });
      } else {
        const box = stack.at(-1);
        // Line breaking adds \leftskip and \rightskip glue at both ends of every line of a
        // paragraph, tagged with the source line that ended the paragraph.
        const edgeGlue =
          kind === "g" &&
          box &&
          (Math.abs(x - box.x) < 0.01 || Math.abs(x - box.x - box.width) < 0.01);
        if (box && !edgeGlue)
          marks.push({ input: Number(input), line: Number(sourceLine), x, box });
      }
    }
  }
  return { inputs, marks };
}

const inputsFor = (synctex: SyncTex, file: string) =>
  new Set([...synctex.inputs].flatMap(([tag, path]) => (path === file ? [tag] : [])));

/** Where source lines `startLine`–`endLine` of `file` render, one rectangle per typeset line. */
export function forwardSearch(
  synctex: SyncTex,
  file: string,
  startLine: number,
  endLine: number,
): PaperPdfBox[] {
  const tags = inputsFor(synctex, file);
  const lines = new Map<LineBox, { inside: number[]; before: boolean; after: number[] }>();
  for (const mark of synctex.marks) {
    if (!tags.has(mark.input) || mark.box.width <= 0) continue;
    const entry = lines.get(mark.box) ?? { inside: [], before: false, after: [] };
    if (mark.line < startLine) entry.before = true;
    else if (mark.line > endLine) entry.after.push(mark.x);
    else entry.inside.push(mark.x);
    lines.set(mark.box, entry);
  }
  const boxes: PaperPdfBox[] = [];
  for (const [box, entry] of lines) {
    if (entry.inside.length === 0) continue;
    // A typeset line shared with neighbouring source lines is clipped where they begin.
    const left = entry.before ? Math.min(...entry.inside) : box.x;
    const last = Math.max(...entry.inside);
    const right = Math.min(box.x + box.width, ...entry.after.filter((x) => x > last));
    if (right <= left) continue;
    boxes.push({ page: box.page, x: left, y: box.y, width: right - left, height: box.height });
  }
  return boxes.toSorted((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
}

/** The width of the lines that typeset source lines `startLine`–`endLine` of `file`. */
export function lineWidth(
  synctex: SyncTex,
  file: string,
  startLine: number,
  endLine: number,
): number | undefined {
  const tags = inputsFor(synctex, file);
  let width: number | undefined;
  for (const mark of synctex.marks) {
    if (
      tags.has(mark.input) &&
      mark.box.width > 0 &&
      mark.line >= startLine &&
      mark.line <= endLine
    )
      width = Math.max(width ?? 0, mark.box.width);
  }
  return width;
}

/** The source location of the typeset text nearest to a point on a page. */
export function backwardSearch(
  synctex: SyncTex,
  point: { page: number; x: number; y: number },
): { file: string; line: number } | undefined {
  let best: { mark: Mark; distance: number; dx: number } | undefined;
  for (const mark of synctex.marks) {
    if (mark.box.page !== point.page) continue;
    const { box } = mark;
    // Boxes nest: a column box contains every line in it, and a point between two lines is in
    // neither. Charging for height lets the nearest text line win over the boxes around it.
    const outside =
      Math.max(box.x - point.x, point.x - box.x - box.width, 0) +
      Math.max(box.y - point.y, point.y - box.y - box.height, 0);
    const distance = outside + box.height / 4;
    // Marks sit at the start of what they describe, so prefer the nearest one at or before x.
    const dx = mark.x <= point.x ? point.x - mark.x : (mark.x - point.x) * 4;
    if (
      best === undefined ||
      distance < best.distance ||
      (distance === best.distance && dx < best.dx)
    )
      best = { mark, distance, dx };
  }
  const file = best && synctex.inputs.get(best.mark.input);
  return best && file !== undefined ? { file, line: best.mark.line } : undefined;
}
