import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as NodeBuffer from "node:buffer";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Toml from "smol-toml";
import * as ProcessRunner from "../processRunner.ts";
import { compilePreview } from "./preview.ts";

it.layer(NodeServices.layer)("proposal previews", (it) => {
  it.effect.each([false, true])(
    "compiles in isolation and reports font failures (configured: %s)",
    (configured) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped();
        const source = String.raw`\documentclass{article}\newcommand{\greek}[1]{\ifdefined\symbfit\symbfit{#1}\else\boldsymbol{#1}\fi}\begin{document}Keep me.\end{document}`;
        yield* fs.writeFileString(path.join(cwd, "main.tex"), source);
        const inputs = [{ inline: String.raw`\RequirePackage[OT1]{fontenc}\input{main.tex}` }];
        if (configured)
          yield* fs.writeFileString(
            path.join(cwd, "Tectonic.toml"),
            Toml.stringify({
              doc: { name: "paper", bundle: "https://example.test/bundle", extra_paths: ["."] },
              output: [{ name: "main", type: "pdf", tex_format: "latex", inputs }],
            }),
          );
        let calls = 0;
        const directories: string[] = [];
        const runner = Layer.succeed(ProcessRunner.ProcessRunner, {
          run: (request) =>
            Effect.gen(function* () {
              calls++;
              expect(request.command).toBe("tectonic");
              expect(request.args).toContain("--keep-logs");
              let directory: string;
              if (configured) {
                directory = request.cwd!;
                const config = Toml.parse(
                  yield* fs.readFileString(path.join(directory, "Tectonic.toml")),
                );
                expect(config.doc).toMatchObject({
                  bundle: "https://example.test/bundle",
                  extra_paths: [cwd],
                });
                expect(config.output).toMatchObject([
                  {
                    tex_format: "latex",
                    inputs: [
                      expect.objectContaining({
                        inline: expect.stringContaining(String.raw`\begin{minipage}{\textwidth}`),
                      }),
                      ...inputs,
                    ],
                  },
                ]);
              } else {
                expect(request.cwd).toBe(cwd);
                expect(request.stdin).toContain(String.raw`\input{main.tex}`);
                expect(request.stdin).toContain(String.raw`\greek{\omega}`);
                directory = request.args[request.args.indexOf("--outdir") + 1]!;
              }
              directories.push(directory);
              const output = configured ? path.join(directory, "build", "preview") : directory;
              const stem = configured ? "preview" : "texput";
              yield* fs.makeDirectory(output, { recursive: true });
              yield* fs.writeFileString(path.join(output, `${stem}.pdf`), "%PDF-preview");
              yield* fs.writeFileString(
                path.join(output, `${stem}.log`),
                calls === 1
                  ? "Final pass OK."
                  : "LaTeX Font Warning: Font shape `TU/ptm/m/it' undefined",
              );
              return {
                code: ChildProcessSpawner.ExitCode(0),
                stdout: "",
                stderr: "",
                timedOut: false,
                stdoutTruncated: false,
                stderrTruncated: false,
                stdoutInvalidUtf8: false,
                stderrInvalidUtf8: false,
              };
            }).pipe(Effect.orDie),
        });
        const preview = compilePreview(cwd, "main.tex", String.raw`$\greek{\omega}$`).pipe(
          Effect.provide(runner),
        );
        const good = yield* preview;
        expect(NodeBuffer.Buffer.from(good.pdf!, "base64").toString()).toBe("%PDF-preview");
        expect(good.diagnostics).toEqual([]);
        const failed = yield* preview;
        expect(failed.pdf).toBeNull();
        expect(failed.diagnostics).toContainEqual(
          expect.objectContaining({
            severity: "error",
            message: expect.stringContaining("Font shape"),
          }),
        );
        for (const directory of directories) expect(yield* fs.exists(directory)).toBe(false);
        expect(yield* fs.readFileString(path.join(cwd, "main.tex"))).toBe(source);
      }),
  );
});
