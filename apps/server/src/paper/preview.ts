import * as NodeBuffer from "node:buffer";
import { PaperError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as Toml from "smol-toml";
import * as ProcessRunner from "../processRunner.ts";
import { parseDiagnostics } from "./diagnostics.ts";

const isPaperError = Schema.is(PaperError);
const Input = Schema.Union([Schema.String, Schema.Struct({ inline: Schema.String })]);
const Configuration = Schema.Struct({
  doc: Schema.Struct({
    bundle: Schema.String,
    extra_paths: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
  output: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      tex_format: Schema.optionalKey(Schema.String),
      inputs: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Input)])),
      preamble: Schema.optionalKey(Schema.String),
      index: Schema.optionalKey(Schema.String),
      postamble: Schema.optionalKey(Schema.String),
    }),
  ),
});

export const compilePreview = Effect.fn("PaperService.compilePreview")(
  function* (cwd: string, mainFile: string, latex: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const runner = yield* ProcessRunner.ProcessRunner;
    const configured = yield* fs.readFileString(path.join(cwd, "Tectonic.toml")).pipe(
      Effect.catchIf(
        (error) => error.reason._tag === "NotFound",
        () => Effect.succeed(null),
      ),
    );
    const config =
      configured === null
        ? null
        : yield* Effect.try(() => Toml.parse(configured)).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Configuration)),
          );
    const output = config?.output.find((output) => output.name === path.basename(mainFile, ".tex"));
    if (config && !output) return yield* new PaperError({ reason: "preview_failed" });
    const inputs =
      output?.inputs ??
      (output
        ? [
            output.preamble ?? "_preamble.tex",
            output.index ?? "index.tex",
            output.postamble ?? "_postamble.tex",
          ]
        : [path.join(cwd, mainFile)]);
    const sources = (typeof inputs === "string" ? [inputs] : inputs).map((input) =>
      typeof input === "string" ? path.resolve(cwd, "src", input) : input,
    );
    // Run the original compiler inputs and packages, then replace only the document body.
    // preview.sty handles cropping; the TeX engine handles macros, conditionals and fonts.
    const hook = String.raw`\AddToHook{begindocument/before}{\RequirePackage[active,tightpage]{preview}}
\AddToHook{begindocument/end}{
\begin{preview}\begin{minipage}{\textwidth}
${latex}
\end{minipage}\end{preview}\end{document}}
`;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-paper-preview-" });
    if (config) {
      const bundle = config.doc.bundle;
      const src = path.join(cwd, "src");
      yield* fs.makeDirectory(path.join(directory, "src"));
      yield* fs.writeFileString(
        path.join(directory, "Tectonic.toml"),
        Toml.stringify({
          doc: {
            name: "t3-paper-preview",
            bundle: /^[a-z][a-z0-9+.-]*:/i.test(bundle) ? bundle : path.resolve(cwd, bundle),
            extra_paths: [
              ...((yield* fs.exists(src)) ? [src] : []),
              ...(config.doc.extra_paths ?? []).map((p) => path.resolve(cwd, p)),
            ],
          },
          output: [
            {
              name: "preview",
              type: "pdf",
              ...(output?.tex_format === undefined ? {} : { tex_format: output.tex_format }),
              inputs: [{ inline: hook }, ...sources],
            },
          ],
        }),
      );
    }
    const build = config ? path.join(directory, "build", "preview") : directory;
    const stem = config ? "preview" : "texput";
    const result = yield* runner
      .run({
        command: "tectonic",
        args: config
          ? ["-X", "build", "--keep-logs", "--target", "preview"]
          : ["-X", "compile", "--keep-logs", "--outdir", directory, "-"],
        cwd: config ? directory : cwd,
        ...(config ? {} : { stdin: hook + String.raw`\input{${mainFile}}` }),
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
                  : "preview_failed",
              cause,
            }),
        ),
      );
    const log = yield* fs.readFileString(path.join(build, `${stem}.log`)).pipe(
      Effect.catchIf(
        (error) => error.reason._tag === "NotFound",
        () => Effect.succeed(null),
      ),
    );
    const diagnostics = parseDiagnostics(
      result.code === 0 && log !== null ? log : `${result.stdout}\n${result.stderr}\n${log ?? ""}`,
      cwd,
    );
    if (result.code !== 0 && !diagnostics.some((entry) => entry.severity === "error"))
      diagnostics.push({ severity: "error", message: "Tectonic could not compile this preview." });
    if (diagnostics.some((entry) => entry.severity === "error")) return { pdf: null, diagnostics };
    const pdf = yield* fs.readFile(path.join(build, `${stem}.pdf`));
    return { pdf: NodeBuffer.Buffer.from(pdf).toString("base64"), diagnostics };
  },
  Effect.scoped,
  Effect.mapError((cause) =>
    isPaperError(cause) ? cause : new PaperError({ reason: "preview_failed", cause }),
  ),
);
