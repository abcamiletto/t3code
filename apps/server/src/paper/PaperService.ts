import {
  PaperError,
  PaperProposal,
  type PaperProposalOption,
  type PaperResolveProposalInput,
  type PaperSourceRange,
  type PaperState,
  type PaperSyncFromPdfInput,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as ProcessRunner from "../processRunner.ts";
import { parseDiagnostics } from "./diagnostics.ts";
import { originalRange, refineSource } from "./source.ts";
import { backwardSearch, forwardSearch } from "./synctex.ts";

interface ProposeInput {
  readonly cwd: string;
  readonly threadId?: string;
  readonly file: string;
  readonly original: string;
  readonly options: ReadonlyArray<PaperProposalOption>;
  readonly summary?: string;
}

export class PaperService extends Context.Service<
  PaperService,
  {
    readonly status: (cwd: string) => Effect.Effect<PaperState, PaperError>;
    readonly currentStatus: (cwd: string) => Effect.Effect<PaperState, PaperError>;
    readonly subscribe: (cwd: string) => Stream.Stream<PaperState, PaperError>;
    readonly build: (cwd: string) => Effect.Effect<void, PaperError>;
    readonly syncFromPdf: (
      input: PaperSyncFromPdfInput,
    ) => Effect.Effect<PaperSourceRange, PaperError>;
    readonly propose: (input: ProposeInput) => Effect.Effect<PaperProposal, PaperError>;
    readonly resolve: (
      input: PaperResolveProposalInput,
    ) => Effect.Effect<PaperProposal, PaperError>;
  }
>()("t3/paper/PaperService") {}

const StoredProposals = Schema.fromJsonString(Schema.Array(PaperProposal));
const decodeProposals = Schema.decodeEffect(StoredProposals);
const encodeProposals = Schema.encodeEffect(StoredProposals);
const watchedExtension = /\.(?:tex|bib|sty|cls|bst|png|jpe?g|pdf|eps|svg|webp|gif|tiff?)$/i;
const ignoredDirectory = /(?:^|[/\\])(?:\.t3-paper|\.git|node_modules)(?:[/\\]|$)/;

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const runner = yield* ProcessRunner.ProcessRunner;
  const serviceScope = yield* Effect.scope;
  const initialization = yield* Semaphore.make(1);
  const workspaces = new Map<
    string,
    {
      cwd: string;
      references: number;
      state: SubscriptionRef.SubscriptionRef<{ paper: PaperState; completedBuild: number }>;
      buildNumber: number;
      lock: Semaphore.Semaphore;
      syncPdf: string | null;
      running: boolean;
      dirty: boolean;
      subscribers: number;
      watcher: Fiber.Fiber<void> | null;
    }
  >();
  type Workspace = NonNullable<ReturnType<typeof workspaces.get>>;

  const io = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.mapError((cause) => new PaperError({ reason: "io_failed", cause })));
  const readOptional = (file: string) =>
    fs.readFileString(file).pipe(
      Effect.catchIf(
        (error) => error.reason._tag === "NotFound",
        () => Effect.succeed(null),
      ),
      io,
    );
  const prepare = (cwd: string) =>
    Effect.gen(function* () {
      yield* io(fs.makeDirectory(path.join(cwd, ".t3-paper", "build"), { recursive: true }));
      yield* io(fs.writeFileString(path.join(cwd, ".t3-paper", ".gitignore"), "*\n"));
    });
  const sourceFile = (cwd: string, file: string) =>
    Effect.gen(function* () {
      const absolute = path.resolve(cwd, file);
      const relative = path.relative(cwd, absolute).replaceAll("\\", "/");
      if (relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) {
        return yield* new PaperError({ reason: "io_failed" });
      }
      // SyncTeX may name package files outside the workspace; never expose those as editable source.
      const real = yield* fs.realPath(absolute).pipe(
        Effect.catchIf(
          (error) => error.reason._tag === "NotFound",
          () => Effect.succeed(null),
        ),
        io,
      );
      if (real === null) return { absolute, relative };
      const root = yield* io(fs.realPath(cwd));
      const realRelative = path.relative(root, real);
      if (
        realRelative === ".." ||
        realRelative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(realRelative)
      ) {
        return yield* new PaperError({ reason: "io_failed" });
      }
      return { absolute, relative };
    });
  const detect = (cwd: string) =>
    Effect.gen(function* () {
      const names = yield* fs
        .readDirectory(cwd)
        .pipe(
          Effect.mapError((cause) => new PaperError({ reason: "workspace_unavailable", cause })),
        );
      const tex = names.filter((name) => name.endsWith(".tex")).sort();
      const main: string[] = [];
      for (const file of tex) {
        const source = yield* io(fs.readFileString(path.join(cwd, file)));
        if (/\\documentclass(?:\s*\[.*?\])?\s*\{/.test(source.replace(/(?<!\\)%[^\n]*/g, "")))
          main.push(file);
      }
      return {
        isLatex: tex.length > 0,
        mainFile: main.includes("main.tex") ? "main.tex" : (main[0] ?? null),
      };
    });
  const acquireWorkspace = (inputCwd: string) =>
    Effect.gen(function* () {
      const cwd = yield* fs
        .realPath(path.resolve(inputCwd))
        .pipe(
          Effect.mapError((cause) => new PaperError({ reason: "workspace_unavailable", cause })),
        );
      const existing = workspaces.get(cwd);
      if (existing) {
        existing.references++;
        return existing;
      }
      const detected = yield* detect(cwd);
      const stored = yield* readOptional(path.join(cwd, ".t3-paper", "proposals.json"));
      const proposals = stored === null ? [] : yield* io(decodeProposals(stored));
      const pdf =
        detected.mainFile === null
          ? null
          : `.t3-paper/build/${path.basename(detected.mainFile, ".tex")}.pdf`;
      const pdfPath = pdf !== null && (yield* io(fs.exists(path.join(cwd, pdf)))) ? pdf : null;
      const state = yield* SubscriptionRef.make<{ paper: PaperState; completedBuild: number }>({
        paper: {
          cwd,
          ...detected,
          build: { status: "idle", revision: 0, pdfPath, diagnostics: [] },
          proposals,
        },
        completedBuild: 0,
      });
      const lock = yield* Semaphore.make(1);
      const entry = {
        cwd,
        references: 1,
        state,
        buildNumber: 0,
        lock,
        syncPdf: pdfPath === null ? null : path.join(cwd, pdfPath),
        running: false,
        dirty: false,
        subscribers: 0,
        watcher: null,
      } satisfies Workspace;
      workspaces.set(cwd, entry);
      return entry;
    }).pipe(initialization.withPermits(1));

  const evict = (entry: Workspace) =>
    Effect.sync(() => {
      if (entry.references === 0 && !entry.running) workspaces.delete(entry.cwd);
    });
  const releaseWorkspace = (entry: Workspace) =>
    Effect.suspend(() => {
      entry.references--;
      return evict(entry);
    });
  const withWorkspace = <A, E, R>(cwd: string, use: (entry: Workspace) => Effect.Effect<A, E, R>) =>
    Effect.acquireUseRelease(acquireWorkspace(cwd), use, releaseWorkspace);

  const persist = (entry: Workspace, proposals: ReadonlyArray<PaperProposal>) =>
    Effect.gen(function* () {
      const { paper: state } = yield* SubscriptionRef.get(entry.state);
      const resolved = new Set(
        proposals
          .filter((proposal) => proposal.status !== "pending")
          .slice(-50)
          .map((proposal) => proposal.id),
      );
      const kept = proposals.filter(
        (proposal) => proposal.status === "pending" || resolved.has(proposal.id),
      );
      yield* prepare(state.cwd);
      const encoded = yield* io(encodeProposals(kept));
      const destination = path.join(state.cwd, ".t3-paper", "proposals.json");
      yield* io(fs.writeFileString(`${destination}.tmp`, encoded));
      yield* io(fs.rename(`${destination}.tmp`, destination));
      yield* SubscriptionRef.update(entry.state, (current) => ({
        ...current,
        paper: { ...current.paper, proposals: kept },
      }));
    });
  // Proposals can still be reviewed in chat or located by PDF.js when source navigation is unavailable.
  const proposalBoxes = (entry: Workspace, file: string, startLine: number, endLine: number) =>
    entry.syncPdf === null
      ? Effect.succeed([])
      : forwardSearch(runner, {
          cwd: entry.cwd,
          pdf: entry.syncPdf,
          file: path.resolve(entry.cwd, file),
          startLine,
          endLine,
        }).pipe(Effect.catchTags({ PaperError: () => Effect.succeed([]) }));
  const refreshProposals = (entry: Workspace) =>
    Effect.gen(function* () {
      const { paper: state } = yield* SubscriptionRef.get(entry.state);
      const proposals: PaperProposal[] = [];
      const stale: PaperProposal[] = [];
      for (const proposal of state.proposals) {
        if (proposal.status !== "pending") {
          proposals.push(proposal);
          continue;
        }
        const source = yield* readOptional(path.join(state.cwd, proposal.file));
        const range = source === null ? undefined : originalRange(source, proposal.original);
        if (range === undefined) {
          stale.push({ ...proposal, status: "stale", boxes: [] });
        } else {
          proposals.push({
            ...proposal,
            startLine: range.startLine,
            endLine: range.endLine,
            boxes: yield* proposalBoxes(entry, proposal.file, range.startLine, range.endLine),
          });
        }
      }
      if (proposals.length + stale.length > 0) yield* persist(entry, [...proposals, ...stale]);
    }).pipe(entry.lock.withPermits(1));

  const compile = (entry: Workspace) =>
    Effect.gen(function* () {
      const {
        paper: { cwd },
      } = yield* SubscriptionRef.get(entry.state);
      const started = yield* Clock.currentTimeMillis;
      const detected = yield* detect(cwd);
      yield* SubscriptionRef.update(entry.state, (state) => ({
        ...state,
        paper: {
          ...state.paper,
          ...detected,
          build: { ...state.paper.build, status: "building" as const, diagnostics: [] },
        },
      }));
      if (detected.mainFile === null) return yield* new PaperError({ reason: "not_latex" });
      yield* prepare(cwd);
      const output = path.join(cwd, ".t3-paper", "build");
      const staging = path.join(output, ".next");
      yield* io(fs.remove(staging, { recursive: true, force: true }));
      yield* io(fs.makeDirectory(staging));
      const result = yield* runner
        .run({
          command: "tectonic",
          args: [
            "-X",
            "compile",
            "--synctex",
            "--keep-logs",
            "--outdir",
            staging,
            detected.mainFile,
          ],
          cwd,
          timeout: "2 minutes",
          maxOutputBytes: 2_000_000,
          outputMode: "truncate",
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new PaperError({
                reason:
                  cause._tag === "ProcessSpawnError" &&
                  cause.cause instanceof PlatformError.PlatformError &&
                  cause.cause.reason._tag === "NotFound"
                    ? "compiler_missing"
                    : "io_failed",
                cause,
              }),
          ),
        );
      const stem = path.basename(detected.mainFile, ".tex");
      const log = yield* readOptional(path.join(staging, `${stem}.log`));
      if (log !== null) yield* io(fs.writeFileString(path.join(output, `${stem}.log`), log));
      const diagnostics = parseDiagnostics(`${result.stdout}\n${result.stderr}\n${log ?? ""}`, cwd);
      if (result.code !== 0 && !diagnostics.some((diagnostic) => diagnostic.severity === "error"))
        diagnostics.push({
          severity: "error",
          message: "Tectonic could not compile the document.",
        });
      if (result.code === 0) {
        // Overwrite in place: signed asset URLs pin the file's inode, so a rename would 404 open viewers.
        const pdf = yield* io(fs.readFile(path.join(staging, `${stem}.pdf`)));
        yield* io(fs.writeFile(path.join(output, `${stem}.pdf`), pdf));
        yield* io(
          fs.rename(
            path.join(staging, `${stem}.synctex.gz`),
            path.join(output, `${stem}.synctex.gz`),
          ),
        );
        entry.syncPdf = path.join(output, `${stem}.pdf`);
        yield* refreshProposals(entry);
      }
      const finished = yield* Clock.currentTimeMillis;
      const finishedAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso));
      yield* SubscriptionRef.update(entry.state, ({ paper: state }) => ({
        completedBuild: entry.buildNumber,
        paper: {
          ...state,
          build: {
            ...state.build,
            status: result.code === 0 ? ("succeeded" as const) : ("failed" as const),
            revision: state.build.revision + (result.code === 0 ? 1 : 0),
            pdfPath: result.code === 0 ? `.t3-paper/build/${stem}.pdf` : state.build.pdfPath,
            diagnostics,
            finishedAt,
            durationMs: finished - started,
          },
        },
      }));
    });
  const reportFailure = (entry: Workspace, error: PaperError, completedBuild?: number) =>
    SubscriptionRef.update(entry.state, ({ paper: state, completedBuild: previous }) => ({
      completedBuild: completedBuild ?? previous,
      paper: {
        ...state,
        build: {
          ...state.build,
          status: "failed" as const,
          diagnostics: [{ severity: "error" as const, message: error.message, code: error.reason }],
        },
      },
    }));
  const requestBuild = (entry: Workspace): Effect.Effect<number> =>
    Effect.gen(function* () {
      if (entry.running) {
        entry.dirty = true;
        return entry.buildNumber + 1;
      }
      entry.running = true;
      const target = ++entry.buildNumber;
      const run: Effect.Effect<void> = Effect.suspend(() =>
        compile(entry).pipe(
          Effect.catchTags({
            PaperError: (error) => reportFailure(entry, error, entry.buildNumber),
          }),
          Effect.andThen(
            Effect.suspend(() => {
              if (entry.dirty) {
                entry.dirty = false;
                entry.buildNumber++;
                return run;
              }
              entry.running = false;
              return evict(entry);
            }),
          ),
        ),
      );
      yield* Effect.forkIn(run, serviceScope);
      return target;
    });
  const awaitCurrentBuild = Effect.fnUntraced(function* (entry: Workspace) {
    const target = yield* requestBuild(entry);
    const completed = yield* SubscriptionRef.changes(entry.state).pipe(
      Stream.filter(
        (state) => state.completedBuild >= target && state.paper.build.status !== "building",
      ),
      Stream.runHead,
    );
    return Option.getOrThrow(completed).paper;
  });
  const acquireWatcher = (entry: Workspace) =>
    Effect.gen(function* () {
      entry.subscribers++;
      if (entry.subscribers > 1) return;
      const {
        paper: { cwd, build },
      } = yield* SubscriptionRef.get(entry.state);
      entry.watcher = yield* fs.watch(cwd, { recursive: true }).pipe(
        Stream.filter(
          (event) => !ignoredDirectory.test(event.path) && watchedExtension.test(event.path),
        ),
        Stream.debounce("300 millis"),
        Stream.runForEach(() => requestBuild(entry)),
        Effect.catch((cause) =>
          reportFailure(entry, new PaperError({ reason: "io_failed", cause })),
        ),
        Effect.forkIn(serviceScope),
      );
      // Reconcile once on reconnect: files may have changed while nobody was watching.
      if (build.pdfPath === null || !entry.running) yield* requestBuild(entry);
    }).pipe(entry.lock.withPermits(1));
  const releaseWatcher = (entry: Workspace) =>
    Effect.gen(function* () {
      entry.subscribers--;
      if (entry.subscribers === 0 && entry.watcher !== null) {
        yield* Fiber.interrupt(entry.watcher);
        entry.watcher = null;
      }
    }).pipe(entry.lock.withPermits(1));

  return PaperService.of({
    status: (cwd) =>
      withWorkspace(cwd, (entry) => SubscriptionRef.get(entry.state)).pipe(
        Effect.map((state) => state.paper),
      ),
    currentStatus: (cwd) => withWorkspace(cwd, awaitCurrentBuild),
    subscribe: (cwd) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const entry = yield* Effect.acquireRelease(acquireWorkspace(cwd), releaseWorkspace);
          yield* Effect.acquireRelease(acquireWatcher(entry), () => releaseWatcher(entry));
          return SubscriptionRef.changes(entry.state).pipe(Stream.map((state) => state.paper));
        }),
      ),
    build: (cwd) => withWorkspace(cwd, requestBuild).pipe(Effect.asVoid),
    syncFromPdf: (input) =>
      withWorkspace(input.cwd, (entry) =>
        Effect.gen(function* () {
          if (entry.syncPdf === null) return yield* new PaperError({ reason: "sync_unavailable" });
          const hit = yield* backwardSearch(runner, { ...input, pdf: entry.syncPdf });
          const file = yield* sourceFile(input.cwd, hit.file);
          const source = yield* io(fs.readFileString(file.absolute));
          return refineSource(file.relative, source, hit.line, input.text);
        }),
      ),
    propose: (input) =>
      withWorkspace(input.cwd, (entry) =>
        Effect.gen(function* () {
          if (entry.syncPdf === null) yield* awaitCurrentBuild(entry);
          return yield* Effect.gen(function* () {
            const file = yield* sourceFile(input.cwd, input.file);
            const source = yield* io(fs.readFileString(file.absolute));
            const range = originalRange(source, input.original);
            if (range === undefined) return yield* new PaperError({ reason: "original_not_found" });
            const id = yield* crypto.randomUUIDv4().pipe(io);
            const createdAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso));
            const proposal: PaperProposal = {
              id,
              file: file.relative,
              original: input.original,
              startLine: range.startLine,
              endLine: range.endLine,
              options: input.options,
              ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
              ...(input.summary === undefined ? {} : { summary: input.summary }),
              boxes: yield* proposalBoxes(entry, file.relative, range.startLine, range.endLine),
              status: "pending",
              createdAt,
            };
            const { paper: state } = yield* SubscriptionRef.get(entry.state);
            // A revised proposal for the same text replaces the one the user was replying to.
            const superseded = (candidate: PaperProposal) => {
              if (
                candidate.status !== "pending" ||
                candidate.file !== proposal.file ||
                candidate.threadId !== proposal.threadId
              )
                return false;
              const previous = originalRange(source, candidate.original);
              return (
                previous !== undefined &&
                previous.start < range.start + input.original.length &&
                range.start < previous.start + candidate.original.length
              );
            };
            yield* persist(entry, [
              ...state.proposals.map((candidate) =>
                superseded(candidate) ? { ...candidate, status: "dismissed" as const } : candidate,
              ),
              proposal,
            ]);
            return proposal;
          }).pipe(entry.lock.withPermits(1));
        }),
      ),
    resolve: (input) =>
      withWorkspace(input.cwd, (entry) =>
        Effect.gen(function* () {
          const { paper: state } = yield* SubscriptionRef.get(entry.state);
          const proposal = state.proposals.find((candidate) => candidate.id === input.proposalId);
          if (proposal === undefined)
            return yield* new PaperError({ reason: "proposal_not_found" });
          if (proposal.status !== "pending")
            return yield* new PaperError({ reason: "proposal_resolved" });
          const save = (resolved: PaperProposal) =>
            persist(entry, [
              ...state.proposals.filter((candidate) => candidate.id !== resolved.id),
              resolved,
            ]).pipe(Effect.as(resolved));
          if (input.resolution.type === "dismiss")
            return yield* save({ ...proposal, status: "dismissed" });
          const option = proposal.options[input.resolution.optionIndex];
          if (option === undefined) return yield* new PaperError({ reason: "invalid_option" });
          const file = yield* sourceFile(state.cwd, proposal.file);
          const source = yield* readOptional(file.absolute);
          const range = source === null ? undefined : originalRange(source, proposal.original);
          if (source === null || range === undefined) {
            yield* save({ ...proposal, status: "stale", boxes: [] });
            return yield* new PaperError({ reason: "proposal_stale" });
          }
          yield* io(
            fs.writeFileString(
              file.absolute,
              source.slice(0, range.start) +
                option.latex +
                source.slice(range.start + proposal.original.length),
            ),
          );
          return yield* save({
            ...proposal,
            status: "applied",
            appliedOptionIndex: input.resolution.optionIndex,
          });
        }).pipe(entry.lock.withPermits(1)),
      ),
  });
});

export const layer = Layer.effect(PaperService, make);
