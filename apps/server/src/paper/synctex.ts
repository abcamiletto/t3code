import { PaperError, type PaperPdfBox } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as PlatformError from "effect/PlatformError";
import type * as ProcessRunner from "../processRunner.ts";

export const backwardSearch = Effect.fn("paper.synctex.backwardSearch")(function* (
  runner: ProcessRunner.ProcessRunner["Service"],
  input: { cwd: string; pdf: string; page: number; x: number; y: number },
) {
  const output = yield* run(runner, input.cwd, [
    "edit",
    "-o",
    `${input.page}:${input.x}:${input.y}:${input.pdf}`,
  ]);
  const hit = results(output)[0];
  const line = Number(hit?.Line);
  if (!hit?.Input || !Number.isInteger(line) || line < 1)
    return yield* new PaperError({ reason: "sync_unavailable" });
  return { file: hit.Input, line };
});

export const forwardSearch = Effect.fn("paper.synctex.forwardSearch")(function* (
  runner: ProcessRunner.ProcessRunner["Service"],
  input: { cwd: string; pdf: string; file: string; startLine: number; endLine: number },
) {
  const rows = yield* Effect.forEach(
    Array.from(
      { length: input.endLine - input.startLine + 1 },
      (_, index) => input.startLine + index,
    ),
    (line) => run(runner, input.cwd, ["view", "-i", `${line}:0:${input.file}`, "-o", input.pdf]),
    { concurrency: 4 },
  );
  const boxes = new Map<string, PaperPdfBox>();
  for (const output of rows) {
    for (const row of results(output)) {
      const page = Number(row.Page);
      const x = Number(row.h);
      const height = Number(row.H);
      const y = Number(row.v) - height;
      const width = Number(row.W);
      if (
        !Number.isInteger(page) ||
        page < 1 ||
        ![x, y, width, height].every(Number.isFinite) ||
        width <= 0 ||
        height <= 0
      )
        continue;
      const box = { page, x, y, width, height };
      boxes.set(`${page}:${x}:${y}:${width}:${height}`, box);
    }
  }
  return [...boxes.values()];
});

const run = Effect.fnUntraced(function* (
  runner: ProcessRunner.ProcessRunner["Service"],
  cwd: string,
  args: string[],
) {
  const output = yield* runner
    .run({
      command: "synctex",
      args: [...args, "-x", ""],
      cwd,
      // SyncTeX otherwise runs user-configured editor/viewer commands instead of returning locations.
      env: { ...process.env, SYNCTEX_EDITOR: "", SYNCTEX_VIEWER: "" },
      timeout: "10 seconds",
      maxOutputBytes: 1_000_000,
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new PaperError({
            reason:
              cause._tag === "ProcessSpawnError" &&
              cause.cause instanceof PlatformError.PlatformError &&
              cause.cause.reason._tag === "NotFound"
                ? "synctex_missing"
                : "sync_unavailable",
            cause,
          }),
      ),
    );
  if (output.code !== 0) return yield* new PaperError({ reason: "sync_unavailable" });
  return output.stdout;
});

function results(output: string): Record<string, string>[] {
  return output
    .replaceAll("\r\n", "\n")
    .split(/^Output:/m)
    .slice(1)
    .map((block) =>
      Object.fromEntries(
        [...block.matchAll(/^(\w+):(.*)$/gm)].map((match) => [match[1]!, match[2]!]),
      ),
    );
}
