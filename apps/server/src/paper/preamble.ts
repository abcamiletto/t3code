import { PaperError } from "@t3tools/contracts";
import * as LatexParser from "@unified-latex/unified-latex-util-parse";
import * as LatexSource from "@unified-latex/unified-latex-util-print-raw";
import * as Effect from "effect/Effect";

const parser = LatexParser.getParser();

type ReadSource = (name: string) => Effect.Effect<{ path: string; source: string }, PaperError>;

export const readPreviewContext = Effect.fn("PaperService.previewContext")(function* (
  mainFile: string | null,
  readSource: ReadSource,
) {
  if (mainFile === null) return { preamble: "", error: null };
  const active = new Set<string>();
  const load = Effect.fn("PaperService.loadPreamble")(function* (
    name: string,
  ): Effect.fn.Return<string, PaperError> {
    const { path, source } = yield* readSource(name);
    if (active.has(path))
      return yield* new PaperError({
        reason: "io_failed",
        cause: new Error(`Cyclic preamble input: ${name}`),
      });
    active.add(path);
    const tree = yield* Effect.try({
      try: () => parser.parse(source),
      catch: (cause) => new PaperError({ reason: "io_failed", cause }),
    });
    const definitions: string[] = [];
    for (const node of tree.content) {
      if (node.type === "environment" && node.env === "document") break;
      if (node.type !== "macro") continue;
      if (
        /^(?:newcommand|renewcommand|providecommand|(?:New|Renew|Provide|Declare)(?:Expandable)?DocumentCommand)$/.test(
          node.content,
        )
      ) {
        definitions.push(LatexSource.printRaw(node));
      } else if (node.content === "input" || node.content === "include") {
        const file = node.args?.findLast((arg) => arg.openMark === "{");
        if (!file)
          return yield* new PaperError({
            reason: "io_failed",
            cause: new Error("Preview requires a braced input filename."),
          });
        definitions.push(yield* load(LatexSource.printRaw(file.content).trim()));
      }
    }
    active.delete(path);
    return definitions.join("\n");
  });
  return yield* load(mainFile).pipe(
    Effect.map((preamble) => ({ preamble, error: null })),
    Effect.catch((cause) =>
      Effect.succeed({
        preamble: "",
        error: `Could not load project macro definitions: ${cause.message}`,
      }),
    ),
  );
});
