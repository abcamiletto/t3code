import { diffWordsWithSpace } from "diff";

export interface DiffPart {
  readonly kind: "same" | "added" | "removed";
  readonly text: string;
}

/**
 * A word-level diff, which reads better than a line diff for prose. A space between two changed
 * words joins the change, so a rewritten phrase reads as one deletion and one insertion.
 */
export function wordDiff(before: string, after: string): DiffPart[] {
  const changes = diffWordsWithSpace(before, after);
  const parts: DiffPart[] = [];
  let removed = "";
  let added = "";
  const flush = () => {
    if (removed) parts.push({ kind: "removed", text: removed });
    if (added) parts.push({ kind: "added", text: added });
    removed = "";
    added = "";
  };
  changes.forEach((change, index) => {
    if (change.removed) removed += change.value;
    else if (change.added) added += change.value;
    else if ((removed || added) && !change.value.trim() && changes[index + 1]) {
      removed += change.value;
      added += change.value;
    } else {
      flush();
      parts.push({ kind: "same", text: change.value });
    }
  });
  flush();
  return parts;
}
