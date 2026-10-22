import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ProcessRunner from "../processRunner.ts";
import * as PaperService from "./PaperService.ts";

const SENTENCE = "An original sentence.";
const DOCUMENT = `\\documentclass{article}\n\\begin{document}\n${SENTENCE}\n\\end{document}\n`;
const OPTIONS = [{ latex: "A clearer sentence." }, { latex: "A shorter one.", note: "Concise" }];
const THREAD = "thread-1";

const sp = (points: number) => Math.round(points * 65536 * (72.27 / 72));
// The sentence on source line 3 renders as one line at (100, 100)-(400, 110) on page 1.
const SYNCTEX = [
  "SyncTeX Version:1",
  "Input:1:./main.tex",
  "Content:",
  "{1",
  `(1,3:${sp(100)},${sp(108)}:${sp(300)},${sp(8)},${sp(2)}`,
  `x1,3:${sp(100)},${sp(108)}`,
  ")",
  "}1",
].join("\n");

interface Compilation {
  readonly cwd: string;
  readonly main: string;
  readonly args: ReadonlyArray<string>;
  /** The `.aux` file a warm build reads beside the document, if any. */
  readonly aux: string | null;
}

/** A Tectonic that writes a PDF, SyncTeX, `.aux` and log, or the log of a failed run. */
const fakeTectonic = (calls: Compilation[], installed: boolean, fail: () => boolean) =>
  Layer.effect(
    ProcessRunner.ProcessRunner,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      return {
        run: (request) =>
          !installed
            ? Effect.fail(
                new ProcessRunner.ProcessSpawnError({
                  command: request.command,
                  argumentCount: request.args.length,
                  cause: PlatformError.systemError({
                    _tag: "NotFound",
                    module: "ChildProcess",
                    method: "spawn",
                  }),
                }),
              )
            : Effect.gen(function* () {
                const outDir = request.args[request.args.indexOf("--outdir") + 1]!;
                const main = yield* fs.readFileString(path.join(request.cwd!, "main.tex"));
                const aux = yield* fs
                  .readFileString(path.join(request.cwd!, "main.aux"))
                  .pipe(Effect.orElseSucceed(() => null));
                calls.push({ cwd: request.cwd!, main, args: request.args, aux });
                yield* fs.writeFileString(path.join(outDir, "main.aux"), "\\relax\n");
                if (fail()) {
                  yield* fs.writeFileString(
                    path.join(outDir, "main.log"),
                    "./main.tex:3: Undefined control sequence.\n",
                  );
                  return output(12);
                }
                yield* fs.writeFileString(path.join(outDir, "main.pdf"), `%PDF ${calls.length}`);
                yield* fs.writeFileString(path.join(outDir, "main.log"), "Output written.\n");
                yield* fs.writeFile(
                  path.join(outDir, "main.synctex.gz"),
                  new Uint8Array(
                    yield* Effect.promise(() =>
                      new Response(
                        new Blob([SYNCTEX]).stream().pipeThrough(new CompressionStream("gzip")),
                      ).arrayBuffer(),
                    ),
                  ),
                );
                return output(0);
              }).pipe(Effect.orDie),
      };
    }),
  );

const output = (code: number): ProcessRunner.ProcessRunOutput => ({
  code: ChildProcessSpawner.ExitCode(code),
  stdout: "",
  stderr: "",
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
  stdoutInvalidUtf8: false,
  stderrInvalidUtf8: false,
});

const setup = (options: { fail?: () => boolean; installed?: boolean } = {}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const cwd = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "paper-test-" }));
    yield* fs.writeFileString(path.join(cwd, "main.tex"), DOCUMENT);
    const calls: Compilation[] = [];
    const context = yield* Layer.build(
      PaperService.layer.pipe(
        Layer.provide(
          fakeTectonic(calls, options.installed ?? true, options.fail ?? (() => false)),
        ),
      ),
    );
    const paper = Context.get(context, PaperService.PaperService);
    const read = (file: string) => fs.readFileString(path.join(cwd, file));
    return { cwd, paper, calls, read, fs, path };
  });

it.layer(NodeServices.layer)("PaperService", (it) => {
  it.effect("publishes each PDF and keeps the last one when a build fails", () =>
    Effect.gen(function* () {
      let failing = false;
      const { cwd, paper, read } = yield* setup({ fail: () => failing });
      const first = yield* paper.current(cwd, THREAD);
      expect(first.mainFile).toBe("main.tex");
      expect(first.build).toMatchObject({
        status: "succeeded",
        pdf: ".t3-paper/main.pdf",
        revision: 1,
        outdated: false,
      });
      expect(yield* read(".t3-paper/main.pdf")).toBe("%PDF 1");

      failing = true;
      yield* paper.build(cwd);
      const failed = yield* paper.current(cwd, THREAD);
      expect(failed.build).toMatchObject({
        status: "failed",
        pdf: ".t3-paper/main.pdf",
        revision: 1,
        outdated: true,
        diagnostics: [
          { severity: "error", message: "Undefined control sequence.", file: "main.tex", line: 3 },
        ],
      });
      expect(yield* read(".t3-paper/main.pdf")).toBe("%PDF 1");
    }).pipe(Effect.scoped),
  );

  it.effect("applies, reopens and dismisses proposals by editing the file", () =>
    Effect.gen(function* () {
      const { cwd, paper, read } = yield* setup();
      yield* paper.current(cwd, THREAD);
      const proposal = yield* paper.propose({
        cwd,
        threadId: THREAD,
        file: "main.tex",
        original: SENTENCE,
        options: OPTIONS,
        summary: "Clearer opening",
      });
      expect(proposal).toMatchObject({ status: "pending", startLine: 3, endLine: 3 });
      expect(proposal.boxes).toHaveLength(1);
      expect((yield* paper.current(cwd, "another-thread")).proposals).toEqual([]);

      const applied = yield* paper.resolve({
        cwd,
        proposalId: proposal.id,
        action: { type: "apply", option: 1 },
      });
      expect(applied).toMatchObject({ status: "applied", appliedOption: 1 });
      expect(yield* read("main.tex")).toContain("A shorter one.");

      const switched = yield* paper.resolve({
        cwd,
        proposalId: proposal.id,
        action: { type: "apply", option: 0 },
      });
      expect(switched.appliedOption).toBe(0);
      expect(yield* read("main.tex")).toBe(DOCUMENT.replace(SENTENCE, "A clearer sentence."));

      const reopened = yield* paper.resolve({
        cwd,
        proposalId: proposal.id,
        action: { type: "reopen" },
      });
      expect(reopened.status).toBe("pending");
      expect(reopened.appliedOption).toBeUndefined();
      expect(yield* read("main.tex")).toBe(DOCUMENT);

      yield* paper.resolve({ cwd, proposalId: proposal.id, action: { type: "dismiss" } });
      expect(yield* read("main.tex")).toBe(DOCUMENT);
      const [stored] = (yield* paper.current(cwd, THREAD)).proposals;
      expect(stored?.status).toBe("dismissed");
    }).pipe(Effect.scoped),
  );

  it.effect("replaces a pending proposal for the same passage and rejects ambiguous text", () =>
    Effect.gen(function* () {
      const { cwd, paper } = yield* setup();
      const input = {
        cwd,
        threadId: THREAD,
        file: "main.tex",
        original: SENTENCE,
        options: OPTIONS,
      };
      const first = yield* paper.propose(input);
      const second = yield* paper.propose(input);
      const { proposals } = yield* paper.current(cwd, THREAD);
      expect(proposals.map((proposal) => [proposal.id, proposal.status])).toEqual([
        [first.id, "dismissed"],
        [second.id, "pending"],
      ]);
      const missing = yield* Effect.flip(paper.propose({ ...input, original: "Not in the file." }));
      expect(missing.reason).toBe("original_not_found");
      const outside = yield* Effect.flip(paper.propose({ ...input, file: "../main.tex" }));
      expect(outside.reason).toBe("outside_workspace");
    }).pipe(Effect.scoped),
  );

  it.effect("typesets an option in a scratch copy without touching the workspace", () =>
    Effect.gen(function* () {
      const { cwd, paper, calls, read, fs, path } = yield* setup();
      const { build } = yield* paper.current(cwd, THREAD);
      const proposal = yield* paper.propose({
        cwd,
        threadId: THREAD,
        file: "main.tex",
        original: SENTENCE,
        options: OPTIONS,
      });
      const builds = calls.length;
      const original = yield* paper.preview({
        cwd,
        proposalId: proposal.id,
        option: null,
        revision: build.revision,
      });
      expect(original).toEqual({
        status: "ready",
        pdf: ".t3-paper/main.pdf",
        boxes: proposal.boxes,
      });
      expect(calls).toHaveLength(builds);

      const preview = yield* paper.preview({
        cwd,
        proposalId: proposal.id,
        option: 0,
        revision: build.revision,
      });
      expect(calls).toHaveLength(builds + 1);
      expect(calls.at(-1)?.cwd).not.toBe(cwd);
      expect(calls.at(-1)?.main).toContain("A clearer sentence.");
      // One TeX pass, reading the main build's references.
      expect(calls.at(-1)?.args).toContain("--reruns");
      expect(calls.at(-1)?.aux).toBe("\\relax\n");
      expect(calls[0]?.args).not.toContain("--reruns");
      expect(yield* read("main.tex")).toBe(DOCUMENT);
      expect(preview).toMatchObject({
        status: "ready",
        pdf: `.t3-paper/previews/${proposal.id}-0-1.pdf`,
      });
      if (preview.status === "ready") expect(yield* read(preview.pdf)).toBe(`%PDF ${builds + 1}`);

      // Clients keep showing a preview while the next build's is typeset, so it outlives one build.
      const kept = `.t3-paper/previews/${proposal.id}-0-1.pdf`;
      const rebuild = Effect.andThen(paper.build(cwd), paper.current(cwd, THREAD));
      expect((yield* rebuild).build.revision).toBe(2);
      expect(yield* fs.exists(path.join(cwd, kept))).toBe(true);
      expect((yield* rebuild).build.revision).toBe(3);
      expect(yield* fs.exists(path.join(cwd, kept))).toBe(false);
    }).pipe(Effect.scoped),
  );

  it.effect("locates the source lines of a PDF selection", () =>
    Effect.gen(function* () {
      const { cwd, paper } = yield* setup();
      yield* paper.current(cwd, THREAD);
      const range = yield* paper.locateSource({
        cwd,
        boxes: [{ page: 1, x: 120, y: 100, width: 100, height: 8 }],
      });
      expect(range).toEqual({ file: "main.tex", startLine: 3, endLine: 3, source: SENTENCE });
    }).pipe(Effect.scoped),
  );

  it.effect("reports when Tectonic is not installed", () =>
    Effect.gen(function* () {
      const { cwd, paper } = yield* setup({ installed: false });
      const state = yield* paper.current(cwd, THREAD);
      expect(state.build).toMatchObject({ status: "unavailable", pdf: null });
    }).pipe(Effect.scoped),
  );
});
