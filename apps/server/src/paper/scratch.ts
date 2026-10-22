import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { PAPER_DIRECTORY } from "./compiler.ts";

// Never linked: version control, Paper's own output, and Tectonic's project output, which the
// scratch build must write to its own directory instead of the author's.
const EXCLUDED = new Set([".git", PAPER_DIRECTORY, "build", "node_modules"]);

/**
 * A temporary copy of the workspace in which `file` reads `contents`, for typesetting one
 * alternative. Everything else is a symbolic link, so the copy is instant at any project size.
 * The last build's `.aux` and `.bbl` files sit beside the document, so one TeX pass resolves
 * references and citations.
 */
export const scratchCopy = Effect.fn("Paper.scratchCopy")(function* (
  cwd: string,
  file: string,
  contents: string,
  stem: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  // TeX records inputs under the real path of its working directory.
  const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "t3-paper-" }));
  const segments = file.split("/");
  const auxiliary = [`${stem}.aux`, `${stem}.bbl`];
  const mirror = Effect.fnUntraced(function* (relative: string, keep: string) {
    for (const entry of yield* fs.readDirectory(path.join(cwd, relative))) {
      const skip = relative === "" && (EXCLUDED.has(entry) || auxiliary.includes(entry));
      if (entry === keep || skip) continue;
      yield* fs.symlink(path.join(cwd, relative, entry), path.join(root, relative, entry));
    }
  });
  for (let depth = 0; depth < segments.length; depth++) {
    const directory = segments.slice(0, depth).join("/");
    if (depth > 0) yield* fs.makeDirectory(path.join(root, directory));
    yield* mirror(directory, segments[depth]!);
  }
  yield* fs.writeFileString(path.join(root, file), contents);
  for (const name of auxiliary) {
    const built = path.join(cwd, PAPER_DIRECTORY, "build", name);
    if (yield* fs.exists(built)) yield* fs.copyFile(built, path.join(root, name));
  }
  return root;
});
