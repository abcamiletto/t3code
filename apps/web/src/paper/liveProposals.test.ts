import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, RunId, ThreadId, type PaperProposal } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { observeProactivePanelUserChoice } from "~/components/ChatView.logic";
import { selectActiveRightPanel, useRightPanelStore } from "~/rightPanelStore";
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
  beforeEach(() =>
    useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} }),
  );

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

  it("opens Paper for a live proposal while preserving later panel choices until the next run", () => {
    const store = useRightPanelStore.getState();
    const input = {
      threadKey: "paper-thread",
      runningTurnId: RunId.make("run-1"),
      userActionRevision: store.getUserActionRevision(threadRef),
    };
    const choice = observeProactivePanelUserChoice(null, input);
    const next = newLivePaperProposal(new Set(), [proposal("live")], threadRef.threadId);
    expect(next?.id).toBe("live");
    expect(
      store.openProactive(
        threadRef,
        { id: "paper", kind: "paper" },
        choice.userActionRevision,
        true,
      ),
    ).toBe(true);
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, threadRef)).toBe(
      "paper",
    );
    store.open(threadRef, "files");
    const revision = store.getUserActionRevision(threadRef);
    const later = observeProactivePanelUserChoice(choice, {
      ...input,
      userActionRevision: revision,
    });
    expect(
      store.openProactive(
        threadRef,
        { id: "paper", kind: "paper" },
        later.userActionRevision,
        true,
      ),
    ).toBe(false);
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, threadRef)).toBe(
      "files",
    );
    const nextRun = observeProactivePanelUserChoice(later, {
      ...input,
      runningTurnId: RunId.make("run-2"),
      userActionRevision: revision,
    });
    expect(
      store.openProactive(
        threadRef,
        { id: "paper", kind: "paper" },
        nextRun.userActionRevision,
        true,
      ),
    ).toBe(true);
  });
});
