import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { isProjectLatexUrl } from "@t3tools/shared/projectFavicon";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { assetEnvironment } from "~/state/assets";

const noFavicon = Atom.make(null);

export function usePaperLauncher(project: EnvironmentProject | null) {
  // Image thumbnails discard URL metadata; read the shared asset request before image caching.
  const result = useAtomValue(
    project
      ? assetEnvironment.createUrl({
          environmentId: project.environmentId,
          input: {
            resource: {
              _tag: "project-favicon",
              cwd: project.workspaceRoot,
              ...(project.faviconPath ? { path: project.faviconPath } : {}),
            },
          },
        })
      : noFavicon,
  );
  return (
    result !== null &&
    isProjectLatexUrl(Option.getOrUndefined(AsyncResult.value(result))?.relativeUrl)
  );
}
