import {
  PaperError,
  PaperProposal,
  type PaperBuild,
  type PaperDiagnostic,
  type PaperLocateSourceInput,
  type PaperPreview,
  type PaperPreviewInput,
  type PaperProposalOption,
  type PaperResolveProposalInput,
  type PaperSourceRange,
  type PaperState,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as RcMap from "effect/RcMap";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as ProcessRunner from "../processRunner.ts";
import { compile, PAPER_DIRECTORY, type CompileResult } from "./compiler.ts";
import { locate, proposalText, reconcile } from "./proposals.ts";
import { scratchCopy } from "./scratch.ts";
import { backwardSearch, forwardSearch, parseSyncTex, type SyncTex } from "./synctex.ts";

export interface ProposeInput {
  readonly cwd: string;
  readonly threadId: string;
  readonly file: string;
  readonly original: string;
  readonly options: ReadonlyArray<PaperProposalOption>;
  readonly summary?: string | undefined;
}

export class PaperService extends Context.Service<
  PaperService,
  {
    readonly subscribe: (cwd: string, threadId: string) => Stream.Stream<PaperState, PaperError>;
    /** The state after a build that reflects the files on disk. */
    readonly current: (cwd: string, threadId: string) => Effect.Effect<PaperState, PaperError>;
    readonly build: (cwd: string) => Effect.Effect<void, PaperError>;
    readonly preview: (input: PaperPreviewInput) => Effect.Effect<PaperPreview, PaperError>;
    readonly locateSource: (
      input: PaperLocateSourceInput,
    ) => Effect.Effect<PaperSourceRange, PaperError>;
    readonly propose: (input: ProposeInput) => Effect.Effect<PaperProposal, PaperError>;
    readonly resolve: (
      input: PaperResolveProposalInput,
    ) => Effect.Effect<PaperProposal, PaperError>;
  }
>()("t3/paper/PaperService") {}

interface WorkspaceState {
  readonly mainFile: string | null;
  readonly build: PaperBuild;
  /** Every thread's proposals; subscribers see their own thread's. */
  readonly proposals: ReadonlyArray<PaperProposal>;
  /** The newest build request this state reflects. */
  readonly settled: number;
}

const StoredProposals = Schema.fromJsonString(Schema.Array(PaperProposal));
const encodeProposals = Schema.encodeEffect(StoredProposals);
const decodeProposals = Schema.decodeEffect(StoredProposals);
const MAX_STORED_PROPOSALS = 200;
const SOURCE_FILE =
  /(?:\.(?:tex|bib|sty|cls|bst|bbx|cbx|png|jpe?g|pdf|eps|svg|tikz|csv|dat)|Tectonic\.toml)$/i;
// Hidden directories hold version control and Paper's own output.
const IGNORED_DIRECTORY = /^(?:\..*|node_modules)$/;
// Tectonic's project builds write to the root `build` directory.
const isIgnored = (directories: ReadonlyArray<string>) =>
  directories[0] === "build" || directories.some((name) => IGNORED_DIRECTORY.test(name));
const DOCUMENT_CLASS = /^[^%\n]*\\documentclass\b/m;

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, index) => byte === b[index]);

const buildFailure = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause);
  return error instanceof Error ? error.message : "Could not run the build.";
};

const io = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.mapError((cause) => new PaperError({ reason: "io_failed", cause })));

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const runner = yield* ProcessRunner.ProcessRunner;
  // Typesetting an alternative compiles the whole document; one at a time keeps the
  // machine responsive while the author's own build runs.
  const previewPermit = yield* Semaphore.make(1);
  const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.provideService(ProcessRunner.ProcessRunner, runner),
    );

  /** A source file's text; a deleted file reads as empty, so nothing is found in it. */
  const readSource = (file: string) =>
    fs.readFileString(file).pipe(
      Effect.catchIf(
        (error) => error.reason._tag === "NotFound",
        () => Effect.succeed(""),
      ),
      io,
    );

  const detectMainFile = Effect.fn("PaperService.detectMainFile")(function* (cwd: string) {
    const entries = yield* io(fs.readDirectory(cwd));
    const documents: string[] = [];
    for (const entry of entries.filter((name) => name.endsWith(".tex")).toSorted()) {
      if (DOCUMENT_CLASS.test(yield* readSource(path.join(cwd, entry)))) documents.push(entry);
    }
    return documents.includes("main.tex") ? "main.tex" : (documents[0] ?? null);
  });

  const loadSyncTex = Effect.fn("PaperService.loadSyncTex")(function* (
    file: string,
    buildRoot: string,
    workspace: string,
  ) {
    const bytes = yield* io(fs.readFile(file));
    const text = yield* Effect.tryPromise({
      try: () =>
        new Response(
          new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream("gzip")),
        ).text(),
      catch: (cause) => new PaperError({ reason: "io_failed", cause }),
    });
    // Inputs are recorded as the compiler opened them, relative to or inside the build root.
    return parseSyncTex(text, (input) =>
      path.resolve(workspace, path.relative(buildRoot, path.resolve(buildRoot, input))),
    );
  });

  const workspaceFile = (cwd: string, file: string) => {
    const relative = path.relative(cwd, path.resolve(cwd, file));
    return relative === "" || relative.startsWith("..") || path.isAbsolute(relative)
      ? Effect.fail(new PaperError({ reason: "outside_workspace" }))
      : Effect.succeed({
          absolute: path.join(cwd, relative),
          relative: relative.replaceAll("\\", "/"),
        });
  };

  const openWorkspace = Effect.fn("PaperService.openWorkspace")(function* (cwd: string) {
    const paperDirectory = path.join(cwd, PAPER_DIRECTORY);
    const stored = yield* readSource(path.join(paperDirectory, "proposals.json"));
    const proposals = stored ? yield* io(decodeProposals(stored)) : [];
    const mainFile = yield* detectMainFile(cwd);
    const stem = mainFile === null ? null : path.basename(mainFile, ".tex");
    const published = stem === null ? null : `${PAPER_DIRECTORY}/${stem}.pdf`;
    // The last published PDF shows right away; the first build replaces it.
    const hasPdf = published !== null && (yield* io(fs.exists(path.join(cwd, published))));
    const publishedSyncTex = path.join(paperDirectory, `${stem}.synctex.gz`);
    const synctex = yield* Ref.make<SyncTex | null>(
      hasPdf && (yield* io(fs.exists(publishedSyncTex)))
        ? yield* loadSyncTex(publishedSyncTex, cwd, cwd)
        : null,
    );
    const state = yield* SubscriptionRef.make<WorkspaceState>({
      mainFile,
      build: {
        status: "idle",
        pdf: hasPdf ? published : null,
        revision: hasPdf ? 1 : 0,
        outdated: false,
        diagnostics: [],
      },
      proposals,
      settled: 0,
    });
    const lock = yield* Semaphore.make(1);
    const requests = yield* Queue.sliding<void>(1);
    const requested = yield* Ref.make(0);
    // Set by every file event before debouncing, so agents never read a build older than an edit.
    const dirty = yield* Ref.make(false);

    const persist = Effect.fn("PaperService.persist")(function* (
      next: ReadonlyArray<PaperProposal>,
    ) {
      const kept = next.slice(-MAX_STORED_PROPOSALS);
      // Boxes belong to one build; the next build recomputes them.
      const encoded = yield* io(
        encodeProposals(kept.map((proposal) => ({ ...proposal, boxes: [] }))),
      );
      yield* io(fs.makeDirectory(paperDirectory, { recursive: true }));
      yield* io(fs.writeFileString(path.join(paperDirectory, ".gitignore"), "*\n"));
      yield* io(fs.writeFileString(path.join(paperDirectory, "proposals.json"), encoded));
      yield* SubscriptionRef.update(state, (current): WorkspaceState => ({
        ...current,
        proposals: kept,
      }));
    });

    /** Re-reads each proposal's passage: its status, where it is now, and where it renders. */
    const refresh = Effect.fn("PaperService.refreshProposals")(function* (
      proposals: ReadonlyArray<PaperProposal>,
    ) {
      const sources = new Map<string, string>();
      const index = yield* Ref.get(synctex);
      const next: PaperProposal[] = [];
      for (const proposal of proposals) {
        const absolute = path.join(cwd, proposal.file);
        const source = sources.get(absolute) ?? (yield* readSource(absolute));
        sources.set(absolute, source);
        const { status, range } = reconcile(proposal, source);
        const { appliedOption: _, ...unapplied } = proposal;
        next.push({
          ...(status === "pending" ? unapplied : proposal),
          status,
          ...(range ? { startLine: range.startLine, endLine: range.endLine } : {}),
          boxes:
            range && index ? forwardSearch(index, absolute, range.startLine, range.endLine) : [],
        });
      }
      return next;
    });

    /** Publishes the build's PDF unless it is the one already shown; returns whether it did. */
    const publish = Effect.fn("PaperService.publish")(function* (
      result: CompileResult,
      stem: string,
    ) {
      if (result.pdf === null) return false;
      const pdf = path.join(paperDirectory, `${stem}.pdf`);
      const built = yield* io(fs.readFile(result.pdf));
      const shown = yield* fs.readFile(pdf).pipe(Effect.orElseSucceed(() => null));
      // A failed build leaves the previous PDF, and Tectonic's output is reproducible.
      if (shown !== null && sameBytes(built, shown)) return false;
      // Clients may be reading the previous PDF; replace it in one step.
      yield* io(fs.writeFile(`${pdf}.tmp`, built));
      yield* io(fs.rename(`${pdf}.tmp`, pdf));
      if (result.synctex !== null) {
        yield* io(fs.copyFile(result.synctex, path.join(paperDirectory, `${stem}.synctex.gz`)));
        yield* Ref.set(synctex, yield* loadSyncTex(result.synctex, cwd, cwd));
      } else {
        yield* Ref.set(synctex, null);
      }
      // Previews typeset an older document. Clients keep showing the last ones while they ask
      // for new ones, so files from the build being replaced stay; older ones go.
      const { build } = yield* SubscriptionRef.get(state);
      const directory = path.join(paperDirectory, "previews");
      const files = yield* fs.readDirectory(directory).pipe(Effect.orElseSucceed(() => []));
      for (const file of files) {
        const revision = Number(/-(\d+)\.pdf$/.exec(file)?.[1]);
        if (!(revision >= build.revision))
          yield* fs.remove(path.join(directory, file)).pipe(Effect.ignore);
      }
      return true;
    });

    const runBuild = Effect.fn("PaperService.build")(function* () {
      const started = yield* Clock.currentTimeMillis;
      const mainFile = yield* detectMainFile(cwd);
      yield* SubscriptionRef.update(state, (current): WorkspaceState => ({
        ...current,
        mainFile,
        build: { ...current.build, status: mainFile === null ? "idle" : "building" },
      }));
      if (mainFile === null) return;
      const result = yield* provide(compile(cwd, mainFile, { warm: false }));
      const durationMs = (yield* Clock.currentTimeMillis) - started;
      if (result === null) {
        yield* SubscriptionRef.update(state, (current): WorkspaceState => ({
          ...current,
          build: { ...current.build, status: "unavailable", diagnostics: [] },
        }));
        return;
      }
      const stem = path.basename(mainFile, ".tex");
      const published = yield* publish(result, stem);
      const failed = result.diagnostics.some((entry) => entry.severity === "error");
      yield* lock.withPermits(1)(
        Effect.gen(function* () {
          const current = yield* SubscriptionRef.get(state);
          yield* persist(yield* refresh(current.proposals));
        }),
      );
      yield* SubscriptionRef.update(state, (current): WorkspaceState => ({
        ...current,
        build: {
          status: failed ? "failed" : "succeeded",
          pdf: published ? `${PAPER_DIRECTORY}/${stem}.pdf` : current.build.pdf,
          revision: current.build.revision + (published ? 1 : 0),
          outdated: !published && failed,
          diagnostics: result.diagnostics,
          durationMs,
        },
      }));
    });

    const requestBuild = Ref.updateAndGet(requested, (count) => count + 1).pipe(
      Effect.tap(() => Queue.offer(requests, undefined)),
    );

    yield* Effect.forkScoped(
      Effect.forever(
        Effect.gen(function* () {
          yield* Queue.take(requests);
          const covers = yield* Ref.get(requested);
          yield* Ref.set(dirty, false);
          // The loop outlives any one build, so even a defect only fails that build.
          yield* runBuild().pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Paper build failed", { cwd, cause }).pipe(
                Effect.andThen(
                  SubscriptionRef.update(state, (current): WorkspaceState => ({
                    ...current,
                    build: {
                      ...current.build,
                      status: "failed",
                      outdated: true,
                      diagnostics: [{ severity: "error", message: buildFailure(cause) }],
                    },
                  })),
                ),
              ),
            ),
          );
          yield* SubscriptionRef.update(state, (current): WorkspaceState => ({
            ...current,
            settled: covers,
          }));
        }),
      ),
    );
    yield* fs.watch(cwd, { recursive: true }).pipe(
      Stream.filter(
        (event) =>
          SOURCE_FILE.test(event.path) &&
          !isIgnored(path.relative(cwd, path.dirname(event.path)).split(path.sep)),
      ),
      Stream.tap(() => Ref.set(dirty, true)),
      Stream.debounce("300 millis"),
      Stream.runForEach(() => requestBuild),
      Effect.catchCause((cause) =>
        Effect.logWarning("Paper stopped watching files", { cwd, cause }),
      ),
      Effect.forkScoped,
    );
    yield* requestBuild;

    const current = Effect.gen(function* () {
      const snapshot = yield* SubscriptionRef.get(state);
      const ticket = (yield* Ref.get(dirty)) ? yield* requestBuild : yield* Ref.get(requested);
      if (snapshot.settled >= ticket) return snapshot;
      const settled = yield* SubscriptionRef.changes(state).pipe(
        Stream.filter((next) => next.settled >= ticket),
        Stream.runHead,
      );
      return Option.getOrElse(settled, () => snapshot);
    });

    return {
      cwd,
      state,
      lock,
      synctex,
      persist,
      refresh,
      requestBuild,
      current,
    };
  });
  type Workspace = Effect.Success<ReturnType<typeof openWorkspace>>;

  const workspaces = yield* RcMap.make({
    lookup: (cwd: string) => openWorkspace(cwd),
    idleTimeToLive: "5 minutes",
  });
  const withWorkspace = <A, E>(
    inputCwd: string,
    use: (workspace: Workspace) => Effect.Effect<A, E>,
  ) =>
    fs.realPath(path.resolve(inputCwd)).pipe(
      Effect.mapError((cause) => new PaperError({ reason: "workspace_unavailable", cause })),
      Effect.flatMap((cwd) => RcMap.get(workspaces, cwd)),
      Effect.flatMap(use),
      Effect.scoped,
    );

  const forThread = (cwd: string, threadId: string, state: WorkspaceState): PaperState => ({
    cwd,
    mainFile: state.mainFile,
    build: state.build,
    proposals: state.proposals.filter((proposal) => proposal.threadId === threadId),
  });

  const findProposal = (workspace: Workspace, proposalId: string) =>
    SubscriptionRef.get(workspace.state).pipe(
      Effect.flatMap(({ proposals }) => {
        const proposal = proposals.find((candidate) => candidate.id === proposalId);
        return proposal === undefined
          ? Effect.fail(new PaperError({ reason: "proposal_not_found" }))
          : Effect.succeed(proposal);
      }),
    );

  const replaceProposal = (workspace: Workspace, proposal: PaperProposal) =>
    SubscriptionRef.get(workspace.state).pipe(
      Effect.flatMap(({ proposals }) =>
        workspace.persist(
          proposals.map((candidate) => (candidate.id === proposal.id ? proposal : candidate)),
        ),
      ),
      Effect.as(proposal),
    );

  /** The whole document typeset in a scratch copy where the passage reads `target`. */
  const typeset = Effect.fn("PaperService.typeset")(function* (
    workspace: Workspace,
    proposal: PaperProposal,
    target: string,
    file: string,
  ) {
    const { mainFile } = yield* SubscriptionRef.get(workspace.state);
    if (mainFile === null) return yield* new PaperError({ reason: "no_document" });
    const absolute = path.join(workspace.cwd, proposal.file);
    const source = yield* readSource(absolute);
    const current = proposalText(proposal);
    const range = locate(source, current);
    if (range === undefined) return yield* new PaperError({ reason: "proposal_stale" });
    const { start, startLine } = range;
    const contents = source.slice(0, start) + target + source.slice(start + current.length);
    return yield* Effect.gen(function* () {
      const root = yield* io(
        provide(
          scratchCopy(workspace.cwd, proposal.file, contents, path.basename(mainFile, ".tex")),
        ),
      );
      const result = yield* provide(compile(root, mainFile, { warm: true })).pipe(io);
      if (result === null) {
        const missing: PaperDiagnostic = {
          severity: "error",
          message: "Tectonic is not installed.",
        };
        return { status: "failed", diagnostics: [missing] } satisfies PaperPreview;
      }
      if (result.pdf === null)
        return { status: "failed", diagnostics: result.diagnostics } satisfies PaperPreview;
      const relative = `${PAPER_DIRECTORY}/previews/${file}`;
      yield* io(
        fs.makeDirectory(path.join(workspace.cwd, PAPER_DIRECTORY, "previews"), {
          recursive: true,
        }),
      );
      yield* io(fs.copyFile(result.pdf, path.join(workspace.cwd, relative)));
      const index =
        result.synctex === null ? null : yield* loadSyncTex(result.synctex, root, workspace.cwd);
      const lines = target.split("\n").length;
      return {
        status: "ready",
        pdf: relative,
        boxes:
          index && target.trim()
            ? forwardSearch(index, absolute, startLine, startLine + lines - 1)
            : [],
      } satisfies PaperPreview;
    }).pipe(Effect.scoped, previewPermit.withPermits(1));
  });

  return PaperService.of({
    subscribe: (cwd, threadId) =>
      Stream.unwrap(
        fs.realPath(path.resolve(cwd)).pipe(
          Effect.mapError((cause) => new PaperError({ reason: "workspace_unavailable", cause })),
          Effect.flatMap((root) => RcMap.get(workspaces, root)),
          Effect.map((workspace) =>
            SubscriptionRef.changes(workspace.state).pipe(
              Stream.map((state) => forThread(workspace.cwd, threadId, state)),
              Stream.changesWith(
                (a, b) =>
                  a.mainFile === b.mainFile &&
                  a.build === b.build &&
                  a.proposals.length === b.proposals.length &&
                  a.proposals.every((proposal, index) => proposal === b.proposals[index]),
              ),
            ),
          ),
        ),
      ),
    current: Effect.fn("PaperService.current")(function* (cwd, threadId) {
      return yield* withWorkspace(cwd, (workspace) =>
        Effect.map(workspace.current, (state) => forThread(workspace.cwd, threadId, state)),
      );
    }),
    build: Effect.fn("PaperService.requestBuild")(function* (cwd) {
      yield* withWorkspace(cwd, (workspace) => workspace.requestBuild);
    }),
    preview: Effect.fn("PaperService.preview")(function* (input) {
      return yield* withWorkspace(input.cwd, (workspace) =>
        Effect.gen(function* () {
          const proposal = yield* findProposal(workspace, input.proposalId);
          const target =
            input.option === null ? proposal.original : proposal.options[input.option]?.latex;
          if (target === undefined) return yield* new PaperError({ reason: "invalid_option" });
          if (proposal.status === "stale")
            return yield* new PaperError({ reason: "proposal_stale" });
          const { build } = yield* SubscriptionRef.get(workspace.state);
          // The current text is what the main PDF already shows.
          if (target === proposalText(proposal) && build.pdf !== null)
            return {
              status: "ready",
              pdf: build.pdf,
              boxes: proposal.boxes,
            } satisfies PaperPreview;
          // Named per build, so clients never see an older preview under the same URL.
          const file = `${proposal.id}-${input.option ?? "original"}-${build.revision}.pdf`;
          return yield* typeset(workspace, proposal, target, file);
        }),
      );
    }),
    locateSource: Effect.fn("PaperService.locateSource")(function* (input) {
      return yield* withWorkspace(input.cwd, (workspace) =>
        Effect.gen(function* () {
          const index = yield* Ref.get(workspace.synctex);
          if (index === null) return yield* new PaperError({ reason: "sync_unavailable" });
          const hits = input.boxes.flatMap((box) =>
            [box.x + 1, box.x + box.width - 1].flatMap((x) => {
              const hit = backwardSearch(index, { page: box.page, x, y: box.y + box.height / 2 });
              return hit ? [hit] : [];
            }),
          );
          // A selection can touch a class file's output; the file with the most hits is the text.
          const files = [...Map.groupBy(hits, (hit) => hit.file)];
          const best = files.toSorted((a, b) => b[1].length - a[1].length)[0];
          if (best === undefined) return yield* new PaperError({ reason: "sync_unavailable" });
          const [file, lines] = best;
          const target = yield* workspaceFile(workspace.cwd, file);
          const sourceLines = (yield* readSource(target.absolute)).split(/\r?\n/);
          let startLine = Math.min(...lines.map((hit) => hit.line));
          let endLine = Math.min(sourceLines.length, Math.max(...lines.map((hit) => hit.line)));
          while (startLine < endLine && !sourceLines[startLine - 1]!.trim()) startLine++;
          while (endLine > startLine && !sourceLines[endLine - 1]!.trim()) endLine--;
          return {
            file: target.relative,
            startLine,
            endLine,
            source: sourceLines.slice(startLine - 1, endLine).join("\n"),
          };
        }),
      );
    }),
    propose: Effect.fn("PaperService.propose")(function* (input) {
      return yield* withWorkspace(input.cwd, (workspace) =>
        Effect.gen(function* () {
          const file = yield* workspaceFile(workspace.cwd, input.file);
          const range = locate(yield* readSource(file.absolute), input.original);
          if (range === undefined) return yield* new PaperError({ reason: "original_not_found" });
          const index = yield* Ref.get(workspace.synctex);
          const proposal: PaperProposal = {
            id: yield* io(crypto.randomUUIDv4()),
            threadId: input.threadId,
            file: file.relative,
            original: input.original,
            options: input.options,
            ...(input.summary ? { summary: input.summary } : {}),
            status: "pending",
            startLine: range.startLine,
            endLine: range.endLine,
            boxes: index ? forwardSearch(index, file.absolute, range.startLine, range.endLine) : [],
            createdAt: DateTime.formatIso(yield* DateTime.now),
          };
          const { proposals } = yield* SubscriptionRef.get(workspace.state);
          // A revised proposal for the same passage replaces the one the author replied to.
          const overlaps = (candidate: PaperProposal) =>
            candidate.status === "pending" &&
            candidate.threadId === proposal.threadId &&
            candidate.file === proposal.file &&
            candidate.startLine <= proposal.endLine &&
            proposal.startLine <= candidate.endLine;
          yield* workspace.persist([
            ...proposals.map((candidate) =>
              overlaps(candidate) ? { ...candidate, status: "dismissed" as const } : candidate,
            ),
            proposal,
          ]);
          return proposal;
        }).pipe(workspace.lock.withPermits(1)),
      );
    }),
    resolve: Effect.fn("PaperService.resolve")(function* (input) {
      return yield* withWorkspace(input.cwd, (workspace) =>
        Effect.gen(function* () {
          const proposal = yield* findProposal(workspace, input.proposalId);
          const { action } = input;
          if (action.type === "dismiss") {
            if (proposal.status !== "pending" && proposal.status !== "stale")
              return yield* new PaperError({ reason: "invalid_action" });
            return yield* replaceProposal(workspace, { ...proposal, status: "dismissed" });
          }
          if (action.type === "apply" && proposal.options[action.option] === undefined)
            return yield* new PaperError({ reason: "invalid_option" });
          if (action.type === "reopen" && proposal.status === "pending")
            return yield* new PaperError({ reason: "invalid_action" });
          const file = yield* workspaceFile(workspace.cwd, proposal.file);
          const source = yield* readSource(file.absolute);
          const current = proposalText(proposal);
          const range = locate(source, current);
          if (range === undefined) {
            if (proposal.status === "pending")
              yield* replaceProposal(workspace, { ...proposal, status: "stale", boxes: [] });
            return yield* new PaperError({ reason: "proposal_stale" });
          }
          const { appliedOption: _, ...unapplied } = proposal;
          const next: PaperProposal =
            action.type === "apply"
              ? { ...proposal, status: "applied", appliedOption: action.option }
              : { ...unapplied, status: "pending" };
          const { start } = range;
          const contents =
            source.slice(0, start) + proposalText(next) + source.slice(start + current.length);
          yield* io(fs.writeFileString(file.absolute, contents));
          const [refreshed] = yield* workspace.refresh([next]);
          return yield* replaceProposal(workspace, refreshed ?? next);
        }).pipe(workspace.lock.withPermits(1)),
      );
    }),
  });
});

export const layer = Layer.effect(PaperService, make);
