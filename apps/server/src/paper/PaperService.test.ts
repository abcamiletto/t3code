import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import type { PaperState } from "@t3tools/contracts";
import * as NodeZlib from "node:zlib";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Queue from "effect/Queue";
import { TestClock } from "effect/testing";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ProcessRunner from "../processRunner.ts";
import * as PaperService from "./PaperService.ts";

const options = [
  { latex: "A clearer sentence." },
  { latex: "A shorter sentence.", note: "Concise" },
];
const document =
  "\\documentclass{article}\n\\begin{document}\nAn original sentence.\n\\end{document}\n";
const input = {
  file: "main.tex",
  original: "An original sentence.",
  options,
  threadId: "thread-1",
};
const result = (code = 0, stderr = ""): ProcessRunner.ProcessRunOutput => ({
  code: ChildProcessSpawner.ExitCode(code),
  stdout: "",
  stderr,
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
  stdoutInvalidUtf8: false,
  stderrInvalidUtf8: false,
});
const layerNoCompiler = Layer.succeed(ProcessRunner.ProcessRunner, {
  run: () =>
    Effect.fail(
      new ProcessRunner.ProcessSpawnError({
        command: "tectonic",
        argumentCount: 7,
        cause: new Error("No compiler"),
      }),
    ),
});
const layerPaper = PaperService.layer.pipe(Layer.provide(layerNoCompiler));
const temporaryPaper = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "paper-test-" });
  yield* fs.writeFileString(path.join(cwd, "main.tex"), document);
  return { fs, path, cwd };
});
const fakeCompile = (request: ProcessRunner.ProcessRunInput) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const output = request.args[request.args.indexOf("--outdir") + 1]!;
    yield* fs.writeFileString(path.join(output, "main.pdf"), "%PDF-test");
    yield* fs.writeFile(
      path.join(output, "main.synctex.gz"),
      NodeZlib.gzipSync(`SyncTeX Version:1
Input:1:${request.cwd}/main.tex
Magnification:1000
Unit:1
X Offset:0
Y Offset:0
Content:
{1
(1,4:655360,1310720:1966080,655360,131072
g1,3:2621440,1310720
)
}1
Postamble:
Count:3
`),
    );
    return result();
  }).pipe(Effect.orDie);

it.layer(NodeServices.layer)("PaperService", (it) => {
  it.effect("builds unwatched files again so current status reflects edits on disk", () =>
    Effect.gen(function* () {
      const { fs, path, cwd } = yield* temporaryPaper;
      let calls = 0;
      const runner: ProcessRunner.ProcessRunner["Service"] = {
        run: (request) =>
          Effect.gen(function* () {
            calls++;
            const source = yield* fs.readFileString(path.join(cwd, "main.tex"));
            if (source.includes("\\badcommand")) {
              return result(1, "error: main.tex:3: Undefined control sequence.");
            }
            return yield* fakeCompile(request);
          }).pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, path),
            Effect.orDie,
          ),
      };
      yield* Effect.gen(function* () {
        const paper = yield* PaperService.PaperService;
        expect((yield* paper.currentStatus(cwd)).build).toMatchObject({
          status: "succeeded",
          revision: 1,
        });
        yield* fs.writeFileString(
          path.join(cwd, "main.tex"),
          document.replace(input.original, "\\badcommand"),
        );
        expect((yield* paper.status(cwd)).build.status).toBe("succeeded");
        const current = yield* paper.currentStatus(cwd);
        expect(current.build).toMatchObject({
          status: "failed",
          revision: 1,
          pdfPath: ".t3-paper/build/main.pdf",
        });
        expect(current.build.diagnostics[0]).toMatchObject({
          severity: "error",
          file: "main.tex",
          line: 3,
        });
        expect(calls).toBe(2);
      }).pipe(
        Effect.provide(
          PaperService.layer.pipe(
            Layer.provide(Layer.succeed(ProcessRunner.ProcessRunner, runner)),
          ),
        ),
      );
    }),
  );

  it.effect.each([false, true])(
    "waits for the requested build rather than an earlier build (watching: %s)",
    (watched) =>
      Effect.gen(function* () {
        const { fs, path, cwd } = yield* temporaryPaper;
        const firstStarted = yield* Deferred.make<void>();
        const firstRelease = yield* Deferred.make<void>();
        const secondStarted = yield* Deferred.make<void>();
        const secondRelease = yield* Deferred.make<void>();
        let calls = 0;
        const runner: ProcessRunner.ProcessRunner["Service"] = {
          run: (request) =>
            Effect.gen(function* () {
              calls++;
              if (calls === 1) {
                yield* Deferred.succeed(firstStarted, undefined);
                yield* Deferred.await(firstRelease);
                return yield* fakeCompile(request);
              }
              yield* Deferred.succeed(secondStarted, undefined);
              yield* Deferred.await(secondRelease);
              return result(1, "error: main.tex:3: Undefined control sequence.");
            }).pipe(
              Effect.provideService(FileSystem.FileSystem, fs),
              Effect.provideService(Path.Path, path),
            ),
        };
        yield* Effect.gen(function* () {
          const paper = yield* PaperService.PaperService;
          if (watched) {
            yield* paper.subscribe(cwd).pipe(Stream.runDrain, Effect.forkScoped);
          } else {
            yield* paper.build(cwd);
          }
          yield* Deferred.await(firstStarted);
          if (watched) yield* paper.build(cwd);
          yield* fs.writeFileString(
            path.join(cwd, "main.tex"),
            document.replace(input.original, "\\badcommand"),
          );
          const status = yield* paper.currentStatus(cwd).pipe(Effect.forkScoped);
          yield* Deferred.succeed(firstRelease, undefined);
          yield* Deferred.await(secondStarted);
          yield* Deferred.succeed(secondRelease, undefined);
          expect((yield* Fiber.join(status)).build).toMatchObject({
            status: "failed",
            revision: 1,
          });
          expect(calls).toBe(2);
        }).pipe(
          Effect.provide(
            PaperService.layer.pipe(
              Layer.provide(Layer.succeed(ProcessRunner.ProcessRunner, runner)),
              Layer.provide(
                Layer.succeed(FileSystem.FileSystem, { ...fs, watch: () => Stream.never }),
              ),
            ),
          ),
        );
      }),
  );

  it.effect("reuses the watched build and returns watched status without requesting another", () =>
    Effect.gen(function* () {
      const { fs, path, cwd } = yield* temporaryPaper;
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let calls = 0;
      const runner: ProcessRunner.ProcessRunner["Service"] = {
        run: (request) =>
          Effect.gen(function* () {
            calls++;
            yield* Deferred.succeed(started, undefined);
            yield* Deferred.await(release);
            return yield* fakeCompile(request);
          }).pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, path),
          ),
      };
      const layer = PaperService.layer.pipe(
        Layer.provide(Layer.succeed(ProcessRunner.ProcessRunner, runner)),
        Layer.provide(Layer.succeed(FileSystem.FileSystem, { ...fs, watch: () => Stream.never })),
      );
      yield* Effect.gen(function* () {
        const paper = yield* PaperService.PaperService;
        yield* paper.subscribe(cwd).pipe(Stream.runDrain, Effect.forkScoped);
        yield* Deferred.await(started);
        const status = yield* paper.currentStatus(cwd).pipe(Effect.forkScoped);
        yield* Deferred.succeed(release, undefined);
        const current = yield* Fiber.join(status);
        expect(current.build).toMatchObject({ status: "succeeded", revision: 1 });
        expect(yield* paper.currentStatus(cwd)).toEqual(current);
        expect(calls).toBe(1);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("builds before the first proposal to provide SyncTeX boxes", () =>
    Effect.gen(function* () {
      const { fs, path, cwd } = yield* temporaryPaper;
      let calls = 0;
      const runner: ProcessRunner.ProcessRunner["Service"] = {
        run: (request) => {
          calls++;
          return fakeCompile(request).pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, path),
          );
        },
      };
      yield* Effect.gen(function* () {
        const paper = yield* PaperService.PaperService;
        const proposal = yield* paper.propose({ ...input, cwd });
        expect(proposal.boxes.length).toBeGreaterThan(0);
        expect((yield* paper.status(cwd)).build.status).toBe("succeeded");
        expect((yield* paper.propose({ ...input, cwd })).boxes).toEqual(proposal.boxes);
        expect(calls).toBe(1);
      }).pipe(
        Effect.provide(
          PaperService.layer.pipe(
            Layer.provide(Layer.succeed(ProcessRunner.ProcessRunner, runner)),
          ),
        ),
      );
    }),
  );

  it.effect("detects root documents and prefers main.tex over other documentclass files", () =>
    Effect.gen(function* () {
      const { fs, path, cwd } = yield* temporaryPaper;
      yield* fs.writeFileString(path.join(cwd, "a.tex"), "\\documentclass{book}");
      yield* fs.writeFileString(path.join(cwd, "fragment.tex"), "A section.");
      const paper = yield* PaperService.PaperService;
      expect((yield* paper.status(cwd)).mainFile).toBe("main.tex");
      const other = yield* fs.makeTempDirectoryScoped();
      yield* fs.writeFileString(path.join(other, "z.tex"), "\\documentclass{book}");
      yield* fs.writeFileString(path.join(other, "a.tex"), "\\documentclass{article}");
      expect((yield* paper.status(other)).mainFile).toBe("a.tex");
      const empty = yield* fs.makeTempDirectoryScoped();
      expect(yield* paper.status(empty)).toMatchObject({ isLatex: false, mainFile: null });
    }).pipe(Effect.provide(layerPaper)),
  );

  it.effect(
    "proposes exact source, persists it across service restarts, and applies the selected option",
    () =>
      Effect.gen(function* () {
        const { fs, path, cwd } = yield* temporaryPaper;
        const paper = yield* PaperService.PaperService;
        const proposal = yield* paper.propose({ ...input, cwd, summary: "Tighten this sentence" });
        expect(proposal).toMatchObject({
          file: "main.tex",
          startLine: 3,
          endLine: 3,
          status: "pending",
          boxes: [],
          threadId: "thread-1",
        });
        expect(yield* fs.readFileString(path.join(cwd, ".t3-paper", ".gitignore"))).toBe("*\n");
        const stored = yield* Effect.gen(function* () {
          const restarted = yield* PaperService.PaperService;
          return yield* restarted.status(cwd);
        }).pipe(Effect.provide(Layer.fresh(layerPaper)));
        expect(stored.proposals).toEqual([proposal]);
        const applied = yield* paper.resolve({
          cwd,
          proposalId: proposal.id,
          resolution: { type: "apply", optionIndex: 1 },
        });
        expect(applied).toMatchObject({ status: "applied", appliedOptionIndex: 1 });
        expect(yield* fs.readFileString(path.join(cwd, "main.tex"))).toBe(
          document.replace(input.original, options[1]!.latex),
        );
        expect(
          yield* paper
            .resolve({ cwd, proposalId: proposal.id, resolution: { type: "dismiss" } })
            .pipe(Effect.flip),
        ).toMatchObject({ reason: "proposal_resolved" });
      }).pipe(Effect.provide(layerPaper)),
  );

  it.effect("rejects non-unique originals, invalid options and files outside the workspace", () =>
    Effect.gen(function* () {
      const { fs, path, cwd } = yield* temporaryPaper;
      const paper = yield* PaperService.PaperService;
      expect(
        yield* paper.propose({ ...input, cwd, original: "missing" }).pipe(Effect.flip),
      ).toMatchObject({ reason: "original_not_found" });
      yield* fs.writeFileString(path.join(cwd, "main.tex"), `${document}${input.original}`);
      expect(yield* paper.propose({ ...input, cwd }).pipe(Effect.flip)).toMatchObject({
        reason: "original_not_found",
      });
      yield* fs.writeFileString(path.join(cwd, "main.tex"), document);
      expect(
        yield* paper.propose({ ...input, cwd, file: "../outside.tex" }).pipe(Effect.flip),
      ).toMatchObject({ reason: "io_failed" });
      const proposal = yield* paper.propose({ ...input, cwd });
      expect(
        yield* paper
          .resolve({ cwd, proposalId: proposal.id, resolution: { type: "apply", optionIndex: 99 } })
          .pipe(Effect.flip),
      ).toMatchObject({ reason: "invalid_option" });
      expect((yield* paper.status(cwd)).proposals[0]!.status).toBe("pending");
    }).pipe(Effect.provide(layerPaper)),
  );

  it.effect(
    "marks an apply stale when source changed or disappeared and preserves the current file",
    () =>
      Effect.gen(function* () {
        const { fs, path, cwd } = yield* temporaryPaper;
        const paper = yield* PaperService.PaperService;
        const proposal = yield* paper.propose({ ...input, cwd });
        const changed = document.replace(input.original, "Edited elsewhere.");
        yield* fs.writeFileString(path.join(cwd, "main.tex"), changed);
        expect(
          yield* paper
            .resolve({
              cwd,
              proposalId: proposal.id,
              resolution: { type: "apply", optionIndex: 0 },
            })
            .pipe(Effect.flip),
        ).toMatchObject({ reason: "proposal_stale" });
        expect((yield* paper.status(cwd)).proposals[0]!.status).toBe("stale");
        expect(yield* fs.readFileString(path.join(cwd, "main.tex"))).toBe(changed);
        yield* fs.writeFileString(path.join(cwd, "main.tex"), document);
        const deleted = yield* paper.propose({ ...input, cwd });
        yield* fs.remove(path.join(cwd, "main.tex"));
        expect(
          yield* paper
            .resolve({ cwd, proposalId: deleted.id, resolution: { type: "apply", optionIndex: 0 } })
            .pipe(Effect.flip),
        ).toMatchObject({ reason: "proposal_stale" });
      }).pipe(Effect.provide(layerPaper)),
  );

  it.effect("dismisses without changing source and retains only 50 resolved proposals", () =>
    Effect.gen(function* () {
      const { fs, path, cwd } = yield* temporaryPaper;
      const paper = yield* PaperService.PaperService;
      const pending = yield* paper.propose({ ...input, cwd });
      yield* Effect.forEach(Array.from({ length: 52 }), () =>
        Effect.gen(function* () {
          const proposal = yield* paper.propose({ ...input, cwd });
          yield* paper.resolve({ cwd, proposalId: proposal.id, resolution: { type: "dismiss" } });
        }),
      );
      const state = yield* paper.status(cwd);
      expect(state.proposals.filter((proposal) => proposal.status === "dismissed")).toHaveLength(
        50,
      );
      expect(state.proposals.find((proposal) => proposal.id === pending.id)?.status).toBe(
        "pending",
      );
      expect(yield* fs.readFileString(path.join(cwd, "main.tex"))).toBe(document);
    }).pipe(Effect.provide(layerPaper)),
  );

  it.effect(
    "coalesces mid-build requests, refreshes pending proposals and keeps the good PDF on failure",
    () =>
      Effect.gen(function* () {
        const { fs, path, cwd } = yield* temporaryPaper;
        const firstStarted = yield* Deferred.make<void>();
        const firstRelease = yield* Deferred.make<void>();
        const secondStarted = yield* Deferred.make<void>();
        const secondRelease = yield* Deferred.make<void>();
        const built = yield* Deferred.make<PaperState>();
        const failed = yield* Deferred.make<PaperState>();
        let calls = 0;
        let watching = 0;
        const proposal = yield* PaperService.PaperService.pipe(
          Effect.flatMap((paper) => paper.propose({ ...input, cwd })),
          Effect.provide(layerPaper),
        );
        const runner: ProcessRunner.ProcessRunner["Service"] = {
          run: (request) =>
            Effect.gen(function* () {
              calls++;
              if (calls === 1) {
                yield* Deferred.succeed(firstStarted, undefined);
                yield* Deferred.await(firstRelease);
              }
              if (calls === 2) {
                yield* Deferred.succeed(secondStarted, undefined);
                yield* Deferred.await(secondRelease);
              }
              if (calls > 2) return result(1, "error: main.tex:3: Undefined control sequence.");
              return yield* fakeCompile(request);
            }).pipe(
              Effect.provideService(FileSystem.FileSystem, fs),
              Effect.provideService(Path.Path, path),
            ),
        };
        const layer = PaperService.layer.pipe(
          Layer.provide(Layer.succeed(ProcessRunner.ProcessRunner, runner)),
          Layer.provide(
            Layer.succeed(FileSystem.FileSystem, {
              ...fs,
              watch: () =>
                Stream.unwrap(
                  Effect.acquireRelease(
                    Effect.sync(() => {
                      watching++;
                      return Stream.never;
                    }),
                    () =>
                      Effect.sync(() => {
                        watching--;
                      }),
                  ),
                ),
            }),
          ),
        );
        yield* Effect.gen(function* () {
          const paper = yield* PaperService.PaperService;
          const subscriber = yield* paper.subscribe(cwd).pipe(
            Stream.runForEach((state) => {
              if (state.build.revision === 2 && state.build.status === "succeeded")
                return Deferred.succeed(built, state);
              if (state.build.status === "failed") return Deferred.succeed(failed, state);
              return Effect.void;
            }),
            Effect.forkScoped,
          );
          yield* Deferred.await(firstStarted);
          expect(watching).toBe(1);
          yield* paper.build(cwd);
          yield* paper.build(cwd);
          yield* paper.build(cwd);
          yield* fs.writeFileString(path.join(cwd, "main.tex"), `\n${document}`);
          yield* Deferred.succeed(firstRelease, undefined);
          yield* Deferred.await(secondStarted);
          expect(calls).toBe(2);
          yield* Deferred.succeed(secondRelease, undefined);
          const state = yield* Deferred.await(built);
          expect(state.proposals.find((item) => item.id === proposal.id)).toMatchObject({
            startLine: 4,
            endLine: 4,
          });
          expect(state.build.pdfPath).toBe(".t3-paper/build/main.pdf");
          const source = yield* paper.syncFromPdf({
            cwd,
            page: 1,
            x: 20,
            y: 15,
            text: input.original,
          });
          expect(source).toMatchObject({
            file: "main.tex",
            startLine: 4,
            endLine: 4,
            source: input.original,
          });
          yield* paper.build(cwd);
          const failure = yield* Deferred.await(failed);
          expect(failure.build).toMatchObject({
            status: "failed",
            revision: 2,
            pdfPath: state.build.pdfPath,
          });
          expect(failure.build.diagnostics[0]).toMatchObject({
            severity: "error",
            file: "main.tex",
            line: 3,
          });
          expect(yield* fs.readFileString(path.join(cwd, failure.build.pdfPath!))).toBe(
            "%PDF-test",
          );
          yield* Fiber.interrupt(subscriber);
          expect(watching).toBe(0);
          expect(calls).toBe(3);
        }).pipe(Effect.provide(layer));
      }),
  );

  it.effect(
    "shares a watcher, ignores generated files, debounces edits and marks vanished originals stale",
    () =>
      Effect.gen(function* () {
        const { fs, path, cwd } = yield* temporaryPaper;
        const events = yield* Queue.unbounded<FileSystem.WatchEvent>();
        const seenIgnored = yield* Deferred.make<void>();
        const seenEdit = yield* Deferred.make<void>();
        const first = yield* Deferred.make<PaperState>();
        const second = yield* Deferred.make<PaperState>();
        let watching = 0;
        let calls = 0;
        const proposal = yield* PaperService.PaperService.pipe(
          Effect.flatMap((paper) => paper.propose({ ...input, cwd })),
          Effect.provide(layerPaper),
        );
        const runner: ProcessRunner.ProcessRunner["Service"] = {
          run: (request) => {
            calls++;
            return fakeCompile(request).pipe(
              Effect.provideService(FileSystem.FileSystem, fs),
              Effect.provideService(Path.Path, path),
            );
          },
        };
        const watch = () =>
          Stream.unwrap(
            Effect.acquireRelease(
              Effect.sync(() => {
                watching++;
                return Stream.fromQueue(events).pipe(
                  Stream.tap((event) =>
                    event.path === "node_modules/image.png"
                      ? Deferred.succeed(seenIgnored, undefined)
                      : event.path === "main.tex"
                        ? Deferred.succeed(seenEdit, undefined)
                        : Effect.void,
                  ),
                );
              }),
              () =>
                Effect.sync(() => {
                  watching--;
                }),
            ),
          );
        const layer = PaperService.layer.pipe(
          Layer.provide(Layer.succeed(ProcessRunner.ProcessRunner, runner)),
          Layer.provide(Layer.succeed(FileSystem.FileSystem, { ...fs, watch })),
        );
        yield* Effect.gen(function* () {
          const paper = yield* PaperService.PaperService;
          const subscriber = yield* paper.subscribe(cwd).pipe(
            Stream.runForEach((state) => {
              if (state.build.revision === 1 && state.build.status === "succeeded")
                return Deferred.succeed(first, state);
              if (state.build.revision === 2 && state.build.status === "succeeded")
                return Deferred.succeed(second, state);
              return Effect.void;
            }),
            Effect.forkScoped,
          );
          const initial = yield* Deferred.await(first);
          expect(initial.proposals[0]!.boxes.length).toBeGreaterThan(0);
          const otherReady = yield* Deferred.make<void>();
          const other = yield* paper.subscribe(cwd).pipe(
            Stream.runForEach(() => Deferred.succeed(otherReady, undefined)),
            Effect.forkScoped,
          );
          yield* Deferred.await(otherReady);
          expect(watching).toBe(1);
          yield* Fiber.interrupt(other);
          expect(watching).toBe(1);
          yield* Queue.offer(events, { _tag: "Update", path: ".t3-paper/build/main.pdf" });
          yield* Queue.offer(events, { _tag: "Update", path: ".git/ignored.tex" });
          yield* Queue.offer(events, { _tag: "Update", path: "node_modules/image.png" });
          yield* Deferred.await(seenIgnored);
          yield* TestClock.adjust("400 millis");
          expect(calls).toBe(1);
          yield* fs.writeFileString(
            path.join(cwd, "main.tex"),
            document.replace(input.original, "A different sentence."),
          );
          yield* Queue.offer(events, { _tag: "Update", path: "main.tex" });
          yield* Queue.offer(events, { _tag: "Update", path: "main.tex" });
          yield* Deferred.await(seenEdit);
          yield* TestClock.adjust("400 millis");
          const rebuilt = yield* Deferred.await(second);
          expect(calls).toBe(2);
          expect(rebuilt.proposals.find((item) => item.id === proposal.id)).toMatchObject({
            status: "stale",
            boxes: [],
          });
          yield* Fiber.interrupt(subscriber);
          expect(watching).toBe(0);
        }).pipe(Effect.provide(layer));
      }),
  );

  it.effect("surfaces a missing compiler in state without failing the subscriber", () =>
    Effect.gen(function* () {
      const { cwd } = yield* temporaryPaper;
      const runner: ProcessRunner.ProcessRunner["Service"] = {
        run: () =>
          Effect.fail(
            new ProcessRunner.ProcessSpawnError({
              command: "tectonic",
              argumentCount: 7,
              cause: PlatformError.systemError({
                _tag: "NotFound",
                module: "ChildProcessSpawner",
                method: "spawn",
              }),
            }),
          ),
      };
      const state = yield* Effect.gen(function* () {
        const paper = yield* PaperService.PaperService;
        const finished = yield* paper.subscribe(cwd).pipe(
          Stream.filter((state) => state.build.status === "failed"),
          Stream.take(1),
          Stream.runCollect,
        );
        return finished[0]!;
      }).pipe(
        Effect.provide(
          PaperService.layer.pipe(
            Layer.provide(Layer.succeed(ProcessRunner.ProcessRunner, runner)),
          ),
        ),
      );
      expect(state.build.diagnostics).toEqual([
        {
          severity: "error",
          message: "Tectonic is not installed. Install it with `brew install tectonic`.",
          code: "compiler_missing",
        },
      ]);
    }),
  );
});
