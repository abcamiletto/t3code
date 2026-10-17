import type { PaperPdfBox } from "@t3tools/contracts";

interface SourceBox extends PaperPdfBox {
  file: string;
  line: number;
}

export interface SyncTex {
  readonly boxes: ReadonlyArray<SourceBox>;
}

const sourcePath = (file: string, cwd: string) => {
  const normalized = file.replaceAll("\\", "/");
  const root = cwd.replaceAll("\\", "/").replace(/\/$/, "");
  return normalized.startsWith(`${root}/`)
    ? normalized.slice(root.length + 1)
    : normalized.replace(/^\.\//, "");
};

export function parseSyncTex(text: string, cwd: string): SyncTex {
  const inputs = new Map<number, string>();
  const boxes: SourceBox[] = [];
  let unit = 1;
  let magnification = 1000;
  let xOffset = 0;
  let yOffset = 0;
  let page = 0;
  const stack: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    depth: number;
    lastX: number;
    lastSource?: { file: string; line: number };
  }> = [];
  const bp = (value: number) => (((value * unit * magnification) / 1000 / 65536) * 72) / 72.27;
  for (const record of text.split(/\r?\n/)) {
    const input = /^Input:(\d+):(.+)$/.exec(record);
    if (input) {
      inputs.set(Number(input[1]), sourcePath(input[2]!, cwd));
      continue;
    }
    const preamble = /^(Unit|Magnification|X Offset|Y Offset):(-?[\d.]+)$/.exec(record);
    if (preamble) {
      const value = Number(preamble[2]);
      switch (preamble[1]) {
        case "Unit":
          unit = value;
          break;
        case "Magnification":
          magnification = value;
          break;
        case "X Offset":
          xOffset = value;
          break;
        case "Y Offset":
          yOffset = value;
          break;
      }
      continue;
    }
    if (/^\{\d+$/.test(record)) {
      page = Number(record.slice(1));
      stack.length = 0;
      continue;
    }
    if (record === ")" || record === "]") {
      stack.pop();
      continue;
    }
    const node =
      /^([[(hvgkrx$])(\d+),(\d+)(?:,\d+)?:(-?\d+),(-?\d+)(?::(-?\d+)(?:,(-?\d+),(-?\d+))?)?/.exec(
        record,
      );
    if (!node || page === 0) continue;
    const [, kind, tag, line, rawX, rawY, rawWidth, rawHeight, rawDepth] = node;
    const x = Number(rawX);
    const y = Number(rawY);
    const parent = stack.at(-1);
    if (kind === "(" || kind === "[") {
      stack.push({
        x,
        y,
        width: Number(rawWidth),
        height: Number(rawHeight),
        depth: Number(rawDepth),
        lastX: x,
      });
      continue;
    }
    const file = inputs.get(Number(tag));
    if (!file || Number(line) < 1) continue;
    const width = rawWidth === undefined ? x - (parent?.lastX ?? x) : Number(rawWidth);
    const left = kind === "g" || kind === "k" ? x - width : x;
    const height = rawHeight === undefined ? (parent?.height ?? 0) : Number(rawHeight);
    const depth = rawDepth === undefined ? (parent?.depth ?? 0) : Number(rawDepth);
    // Glyphs are not recorded individually. The gap before a trailing kern
    // can be the only evidence for a one-word source line.
    if (parent?.lastSource && left > parent.lastX && parent.height + parent.depth > 0) {
      boxes.push({
        ...parent.lastSource,
        page,
        x: bp(parent.lastX) + (xOffset * unit) / 65781.76,
        y: bp(y - parent.height) + (yOffset * unit) / 65781.76,
        width: bp(left - parent.lastX),
        height: bp(parent.height + parent.depth),
      });
    }
    if (parent) {
      parent.lastX = kind === "g" || kind === "k" ? x : x + width;
      parent.lastSource = { file, line: Number(line) };
    }
    if (width === 0 || height + depth === 0) continue;
    boxes.push({
      file,
      line: Number(line),
      page,
      x: bp(Math.min(left, left + width)) + (xOffset * unit) / 65781.76,
      y: bp(y - height) + (yOffset * unit) / 65781.76,
      width: bp(Math.abs(width)),
      height: bp(height + depth),
    });
  }
  return { boxes };
}

export function forwardSearch(
  sync: SyncTex,
  file: string,
  startLine: number,
  endLine: number,
): PaperPdfBox[] {
  const rows = new Map<string, PaperPdfBox>();
  for (const box of sync.boxes) {
    if (box.file !== file || box.line < startLine || box.line > endLine) continue;
    const key = `${box.page}:${box.y}:${box.height}`;
    const row = rows.get(key);
    if (row) {
      const right = Math.max(row.x + row.width, box.x + box.width);
      rows.set(key, { ...row, x: Math.min(row.x, box.x), width: right - Math.min(row.x, box.x) });
    } else {
      rows.set(key, { page: box.page, x: box.x, y: box.y, width: box.width, height: box.height });
    }
  }
  return [...rows.values()];
}

export function backwardSearch(sync: SyncTex, page: number, x: number, y: number) {
  let nearest: SourceBox | undefined;
  let distance = Infinity;
  for (const box of sync.boxes) {
    if (box.page !== page) continue;
    const dx = Math.max(box.x - x, 0, x - box.x - box.width);
    const dy = Math.max(box.y - y, 0, y - box.y - box.height);
    const candidate = dx * dx + dy * dy;
    if (candidate < distance) {
      nearest = box;
      distance = candidate;
    }
  }
  return nearest === undefined ? undefined : { file: nearest.file, line: nearest.line };
}
