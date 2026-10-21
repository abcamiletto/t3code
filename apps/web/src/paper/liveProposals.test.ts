import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type PaperProposal } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { newLivePaperProposal } from "./liveProposals";

const threadRef = scopeThreadRef(EnvironmentId.make("paper-env"), ThreadId.make("paper-thread"));
const proposal = (id: string, status: PaperProposal["status"] = "pending"): PaperProposal => ({
  id,
  threadId: threadRef.threadId,
  file: "main.tex",
  original: "Original.",
  startLine: 1,
  endLine: 1,
  options: [{ latex: "Alternative." }],
  status,
  boxes: [],
  createdAt: "2026-10-17T12:00:00.000Z",
});

describe("live paper proposals", () => {
  it("baselines history and selects the newest live pending proposal in this thread", () => {
    const history = proposal("history");
    expect(newLivePaperProposal(undefined, [history], threadRef.threadId)).toBeUndefined();
    const previous = new Set([history.id]);
    const first = proposal("first");
    const latest = proposal("latest");
    expect(newLivePaperProposal(previous, [history, first, latest], threadRef.threadId)).toBe(
      latest,
    );
    expect(
      newLivePaperProposal(
        new Set([history.id, first.id, latest.id]),
        [history, first, latest],
        threadRef.threadId,
      ),
    ).toBeUndefined();
  });

  it("ignores resolved proposals and other threads sharing the workspace", () => {
    expect(
      newLivePaperProposal(
        new Set(),
        [
          proposal("applied", "applied"),
          proposal("dismissed", "dismissed"),
          proposal("stale", "stale"),
          { ...proposal("other"), threadId: "other-thread" },
        ],
        threadRef.threadId,
      ),
    ).toBeUndefined();
  });
});
