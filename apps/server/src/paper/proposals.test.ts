import type { PaperProposal } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { locate, reconcile } from "./proposals.ts";

const proposal: PaperProposal = {
  id: "p1",
  threadId: "t1",
  file: "main.tex",
  original: "An original sentence.",
  options: [{ latex: "A clearer sentence." }, { latex: "" }],
  status: "pending",
  startLine: 3,
  endLine: 3,
  boxes: [],
  createdAt: "2026-10-22T00:00:00.000Z",
};
const source = (text: string) => `\\begin{document}\n\n${text}\n\\end{document}\n`;

describe("locate", () => {
  it("finds text that occurs exactly once", () => {
    expect(locate("a\nbc\nd", "bc\nd")).toEqual({ start: 2, startLine: 2, endLine: 3 });
    expect(locate("x x", "x")).toBeUndefined();
    expect(locate("x", "")).toBeUndefined();
  });
});

describe("reconcile", () => {
  it("follows the file when the author undoes or applies text in an editor", () => {
    const applied = { ...proposal, status: "applied" as const, appliedOption: 0 };
    expect(reconcile(applied, source("A clearer sentence.")).status).toBe("applied");
    expect(reconcile(applied, source("An original sentence."))).toEqual({
      status: "pending",
      range: { start: 18, startLine: 3, endLine: 3 },
    });
    expect(reconcile(proposal, source("Rewritten by hand.")).status).toBe("stale");
  });

  it("keeps an applied option applied until the original returns", () => {
    const deleted = { ...proposal, status: "applied" as const, appliedOption: 1 };
    expect(reconcile(deleted, source(""))).toEqual({ status: "applied", appliedOption: 1 });
    expect(reconcile(deleted, source("An original sentence.")).status).toBe("pending");
    const edited = { ...proposal, status: "applied" as const, appliedOption: 0 };
    expect(reconcile(edited, source("A clearer sentence, edited again."))).toEqual({
      status: "applied",
      appliedOption: 0,
    });
  });

  it("recognizes an option written into the file without Apply", () => {
    expect(reconcile(proposal, source("A clearer sentence."))).toEqual({
      status: "applied",
      appliedOption: 0,
      range: { start: 18, startLine: 3, endLine: 3 },
    });
  });

  it("recognizes an insertion whose option retains the original anchor", () => {
    const inserted = { ...proposal, options: [{ latex: `Added text. ${proposal.original}` }] };
    expect(reconcile(inserted, source(inserted.options[0]!.latex)).status).toBe("applied");
    expect(
      reconcile(
        { ...inserted, status: "applied", appliedOption: 0 },
        source(`Edited text. ${proposal.original}`),
      ),
    ).toEqual({ status: "applied", appliedOption: 0 });
  });

  it("keeps a dismissal", () => {
    expect(reconcile({ ...proposal, status: "dismissed" }, source("x")).status).toBe("dismissed");
  });
});
