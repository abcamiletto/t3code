import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";

export const rootTexFiles = Effect.fn("Paper.rootTexFiles")(function* (
  fs: FileSystem.FileSystem,
  cwd: string,
) {
  const entries = yield* fs.readDirectory(cwd);
  return entries.filter((entry) => entry.endsWith(".tex")).sort();
});
