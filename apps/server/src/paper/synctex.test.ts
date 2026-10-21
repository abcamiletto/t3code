import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as PlatformError from "effect/PlatformError";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as ProcessRunner from "../processRunner.ts";
import { backwardSearch, forwardSearch } from "./synctex.ts";

const input = {
  cwd: "/paper",
  pdf: "/paper/.t3-paper/build/main.pdf",
  page: 1,
  x: 244.14,
  y: 473.27,
};
const output = (stdout: string): ProcessRunner.ProcessRunOutput => ({
  stdout,
  stderr: "",
  code: ChildProcessSpawner.ExitCode(0),
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
  stdoutInvalidUtf8: false,
  stderrInvalidUtf8: false,
});

it.effect("uses the SyncTeX tool's source location instead of interpreting enclosing boxes", () =>
  Effect.gen(function* () {
    const requests: ProcessRunner.ProcessRunInput[] = [];
    const runner: ProcessRunner.ProcessRunner["Service"] = {
      run: (request) => {
        requests.push(request);
        return Effect.succeed(
          output(`This is SyncTeX command line utility, version 1.5
SyncTeX result begin
Output:${input.pdf}
Input:/paper/sec/0_abstract.tex
Line:3
Column:-1
Offset:0
Context:
SyncTeX result end
`),
        );
      },
    };
    expect(yield* backwardSearch(runner, input)).toEqual({
      file: "/paper/sec/0_abstract.tex",
      line: 3,
    });
    expect(requests[0]).toMatchObject({
      command: "synctex",
      cwd: "/paper",
      args: ["edit", "-o", `1:244.14:473.27:${input.pdf}`, "-x", ""],
      env: { SYNCTEX_EDITOR: "", SYNCTEX_VIEWER: "" },
    });
  }),
);

it.effect("converts forward results to top-left rectangles and removes repeated line boxes", () =>
  Effect.gen(function* () {
    const runner: ProcessRunner.ProcessRunner["Service"] = {
      run: () =>
        Effect.succeed(
          output(`SyncTeX result begin
Output:${input.pdf}
Page:2
x:99
y:88
h:10
v:30
W:100
H:10
Output:${input.pdf}
Page:2
h:10
v:50
W:100
H:10
SyncTeX result end
`),
        ),
    };
    expect(
      yield* forwardSearch(runner, { ...input, file: "/paper/main.tex", startLine: 3, endLine: 4 }),
    ).toEqual([
      { page: 2, x: 10, y: 20, width: 100, height: 10 },
      { page: 2, x: 10, y: 40, width: 100, height: 10 },
    ]);
  }),
);

it.effect("reports missing tools and absent results instead of inventing a source location", () =>
  Effect.gen(function* () {
    const runner: ProcessRunner.ProcessRunner["Service"] = {
      run: () =>
        Effect.fail(
          new ProcessRunner.ProcessSpawnError({
            command: "synctex",
            argumentCount: 5,
            cause: PlatformError.systemError({
              _tag: "NotFound",
              module: "ChildProcessSpawner",
              method: "spawn",
            }),
          }),
        ),
    };
    expect(yield* backwardSearch(runner, input).pipe(Effect.flip)).toMatchObject({
      reason: "synctex_missing",
    });
    const empty = {
      run: () => Effect.succeed(output("SyncTeX result begin\nSyncTeX result end\n")),
    };
    expect(yield* backwardSearch(empty, input).pipe(Effect.flip)).toMatchObject({
      reason: "sync_unavailable",
    });
    expect(
      yield* forwardSearch(empty, { ...input, file: "/paper/main.tex", startLine: 3, endLine: 3 }),
    ).toEqual([]);
  }),
);
