import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { isProjectLatexFaviconUrl } from "@t3tools/shared/projectFavicon";
import { Atom } from "effect/reactivity";
import { projectFaviconUrlAtom } from "~/state/assets";

const noFavicon = Atom.make(null);

export function usePaperLauncher(project: EnvironmentProject | null) {
  const url = useAtomValue(
    project
      ? projectFaviconUrlAtom({
          environmentId: project.environmentId,
          cwd: project.workspaceRoot,
          faviconPath: project.faviconPath,
        })
      : noFavicon,
  );
  return isProjectLatexFaviconUrl(url);
}
