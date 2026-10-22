import type { PaperDiagnostic } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";

import * as ProcessRunner from "../processRunner.ts";
import { parseDiagnostics } from "./diagnostics.ts";

/** Paper's own files inside the workspace; the directory ignores itself in Git. */
export const PAPER_DIRECTORY = ".t3-paper";

export interface CompileResult {
  /** The PDF in the output directory, which may predate this run when it failed early. */
  readonly pdf: string | null;
  readonly synctex: string | null;
  readonly diagnostics: ReadonlyArray<PaperDiagnostic>;
}

/**
 * Builds `mainFile` in `cwd` with Tectonic, the one compiler Paper supports: a single binary that
 * fetches packages on demand and runs BibTeX and reruns itself. A `Tectonic.toml` selects a
 * project build, so its bundle and inputs apply. Returns `null` when Tectonic is not installed.
 *
 * `warm` makes one TeX pass that reads the `.aux` and `.bbl` files placed beside the document,
 * which is how previews reuse the last full build.
 */
export const compile = Effect.fn("Paper.compile")(function* (
  cwd: string,
  mainFile: string,
  options: { readonly warm: boolean },
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const stem = path.basename(mainFile, ".tex");
  const outDir = path.join(cwd, PAPER_DIRECTORY, "build");
  yield* fs.makeDirectory(outDir, { recursive: true });
  yield* fs.writeFileString(path.join(cwd, PAPER_DIRECTORY, ".gitignore"), "*\n");

  const project = yield* fs.exists(path.join(cwd, "Tectonic.toml"));
  const output = yield* tectonic(
    cwd,
    project
      ? ["-X", "build", "--keep-logs"]
      : [
          "-X",
          "compile",
          "--synctex",
          "--keep-logs",
          "--keep-intermediates",
          ...(options.warm ? ["--reruns", "0"] : []),
          "--outdir",
          outDir,
          mainFile,
        ],
  );
  if (Option.isNone(output)) return null;
  const { code, stderr, timedOut } = output.value;

  // Project builds always write to build/<output>/, named in Tectonic.toml.
  const pdf = project
    ? ((yield* newestPdf(path.join(cwd, "build"))) ?? path.join(cwd, "build", stem, `${stem}.pdf`))
    : path.join(outDir, `${stem}.pdf`);
  const sibling = (extension: string) => pdf.replace(/\.pdf$/, extension);
  const log = yield* fs.readFileString(sibling(".log")).pipe(Effect.orElseSucceed(() => ""));
  const diagnostics = parseDiagnostics(`${log}\n${consoleErrors(stderr)}`, cwd);
  const failed = code !== 0 || timedOut;
  const fallback: PaperDiagnostic = {
    severity: "error",
    message: timedOut
      ? "Tectonic did not finish within 3 minutes."
      : "Tectonic could not compile the document.",
  };
  return {
    pdf: (yield* fs.exists(pdf)) ? pdf : null,
    synctex: (yield* fs.exists(sibling(".synctex.gz"))) ? sibling(".synctex.gz") : null,
    diagnostics:
      failed && !diagnostics.some((entry) => entry.severity === "error")
        ? [...diagnostics, fallback]
        : diagnostics,
  } satisfies CompileResult;
});

/**
 * Typesets a standalone `file` in one pass. TeX finds the workspace's inputs on the search path,
 * and keeps going past errors so that one broken passage does not hide the others.
 */
export const compileSnippet = Effect.fn("Paper.compileSnippet")(function* (
  cwd: string,
  file: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const output = yield* tectonic(path.dirname(file), [
    "-X",
    "compile",
    "--reruns",
    "0",
    // Tectonic writes the log only with the intermediates.
    "--keep-logs",
    "--keep-intermediates",
    "-Z",
    "continue-on-errors",
    "-Z",
    `search-path=${cwd}`,
    file,
  ]);
  if (Option.isNone(output)) return null;
  const pdf = file.replace(/\.tex$/, ".pdf");
  return {
    pdf: output.value.code === 0 && (yield* fs.exists(pdf)) ? pdf : null,
    log: yield* fs
      .readFileString(file.replace(/\.tex$/, ".log"))
      .pipe(Effect.orElseSucceed(() => "")),
    diagnostics: parseDiagnostics(consoleErrors(output.value.stderr), cwd),
  };
});

/** Runs Tectonic; `None` when it is not installed. */
const tectonic = Effect.fnUntraced(function* (cwd: string, args: ReadonlyArray<string>) {
  const runner = yield* ProcessRunner.ProcessRunner;
  return yield* runner
    .run({
      command: "tectonic",
      args,
      cwd,
      timeout: "3 minutes",
      timeoutBehavior: "timedOutResult",
      maxOutputBytes: 4_000_000,
      outputMode: "truncate",
    })
    .pipe(
      Effect.asSome,
      Effect.catchIf(
        (error) =>
          error._tag === "ProcessSpawnError" &&
          error.cause instanceof PlatformError.PlatformError &&
          error.cause.reason._tag === "NotFound",
        () => Effect.succeedNone,
      ),
    );
});

// Tectonic's console repeats font and box notes for every pass; the log holds the warnings.
const consoleErrors = (stderr: string) =>
  stderr
    .split("\n")
    .flatMap((line) => (line.startsWith("error: ") ? [line.slice("error: ".length)] : []))
    .join("\n");

const newestPdf = Effect.fnUntraced(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const entries = yield* fs
    .readDirectory(directory, { recursive: true })
    .pipe(Effect.orElseSucceed((): string[] => []));
  let newest: { file: string; time: number } | undefined;
  for (const entry of entries.filter((name) => name.endsWith(".pdf"))) {
    const file = path.join(directory, entry);
    const info = yield* fs.stat(file).pipe(Effect.option);
    const time = Option.getOrUndefined(Option.flatMap(info, (value) => value.mtime))?.getTime();
    if (time !== undefined && (newest === undefined || time > newest.time)) newest = { file, time };
  }
  return newest?.file;
});
