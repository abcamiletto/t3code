import {
  MessageId,
  NodeId,
  ProviderInstanceId,
  ProviderThreadId,
  RunAttemptId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2TurnItem,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2RunAttempt,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";
import { deriveTimelineEntriesFromVisibleTurnItems, type TimelineEntry } from "~/session-logic";
import {
  computeStableMessagesTimelineRows,
  deriveMessagesTimelineRows,
} from "~/components/chat/MessagesTimeline.logic";
import * as ProposalLinks from "@t3tools/shared/paperProposalLinks";

describe("paper proposals in the timeline", () => {
  const runId = RunId.make("paper-run");
  const at = (second: number) =>
    DateTime.makeUnsafe(`2026-09-04T12:00:${String(second).padStart(2, "0")}.000Z`);
  const base = (id: string, second: number) => ({
    id: TurnItemId.make(id),
    threadId: ThreadId.make("paper-thread"),
    runId,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: second,
    status: "completed" as const,
    title: null,
    startedAt: at(second),
    completedAt: at(second),
    updatedAt: at(second),
  });
  const visible = (item: OrchestrationV2TurnItem): OrchestrationV2ProjectedTurnItem => ({
    position: item.ordinal,
    visibility: "local",
    sourceThreadId: item.threadId,
    sourceItemId: item.id,
    item,
  });
  const paperProposal = { cwd: "/workspace/paper", proposalId: "proposal-1" };
  const proposeCall = (
    status: OrchestrationV2TurnItem["status"],
    output?: unknown,
  ): OrchestrationV2TurnItem => ({
    ...base("proposal", 2),
    status,
    type: "dynamic_tool",
    toolName: "mcp__t3-code__paper_propose_edits",
    input: {},
    ...(output === undefined ? {} : { output }),
  });
  const command = (id: string, second: number): OrchestrationV2TurnItem => ({
    ...base(id, second),
    type: "command_execution",
    input: "vp test run",
  });
  const turn = (proposal: OrchestrationV2TurnItem, reply = "Here it is.") => {
    const items: OrchestrationV2TurnItem[] = [
      {
        ...base("prompt", 0),
        type: "user_message",
        messageId: MessageId.make("prompt"),
        inputIntent: "turn_start",
        text: "Rewrite this",
        createdBy: "user",
        creationSource: "server",
        attachments: [],
      },
      command("before", 1),
      proposal,
      command("after", 3),
      {
        ...base("reply", 4),
        type: "assistant_message",
        messageId: MessageId.make("reply"),
        text: reply,
        streaming: false,
      },
    ];
    return deriveTimelineEntriesFromVisibleTurnItems({
      visibleTurnItems: items.map(visible),
      optimisticMessages: [],
    });
  };
  const rowsFor = (entries: TimelineEntry[], expanded: boolean) =>
    deriveMessagesTimelineRows({
      timelineEntries: entries,
      latestRun: {
        runId,
        status: "completed",
        startedAt: DateTime.formatIso(at(0)),
        completedAt: DateTime.formatIso(at(5)),
      },
      ...(expanded ? { expandedRunIds: new Set([runId]) } : {}),
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaries: [],
      supportsConversationRollback: false,
    }).map((row) => row.kind);

  it("shows a completed proposal in place, above the reply, through the turn fold", () => {
    const entries = turn(
      proposeCall("completed", { structuredContent: { paperProposal }, content: [] }),
    );
    expect(entries.find((entry) => entry.kind === "paper-proposal")).toMatchObject({
      id: "proposal",
      runId,
      paperProposal,
    });
    expect(rowsFor(entries, false)).toEqual(["message", "turn-fold", "paper-proposal", "message"]);
    expect(rowsFor(entries, true)).toEqual([
      "message",
      "turn-fold",
      "work",
      "paper-proposal",
      "work",
      "message",
    ]);
  });

  it("keeps a proposal visible when its superseded attempt folds", () => {
    const attempt: OrchestrationV2RunAttempt = {
      id: RunAttemptId.make("attempt-superseded"),
      runId,
      attemptOrdinal: 1,
      rootNodeId: NodeId.make("node-superseded"),
      providerInstanceId: ProviderInstanceId.make("codex-default"),
      providerThreadId: ProviderThreadId.make("provider-thread"),
      providerTurnId: null,
      reason: "initial",
      status: "superseded",
      startedAt: at(0),
      completedAt: at(4),
    };
    const entries = turn(
      proposeCall("completed", { structuredContent: { paperProposal }, content: [] }),
    ).map((entry) =>
      entry.kind === "message" && entry.message.role === "user" ? entry : { ...entry, attempt },
    );
    expect(rowsFor(entries, true)).toEqual([
      "message",
      "turn-fold",
      "attempt-fold",
      "paper-proposal",
    ]);
  });

  it("renders a referenced proposal only inside the reply and keeps code examples out of placement", () => {
    const proposal = proposeCall("completed", { structuredContent: { paperProposal } });
    const markdown = ProposalLinks.formatPaperProposalLink(paperProposal);
    expect(
      rowsFor(turn(proposal, `Choose a refinement.\n\n${markdown}\n\nI recommend A.`), false),
    ).toEqual(["message", "turn-fold", "message"]);
    expect(rowsFor(turn(proposal, `\`\`\`markdown\n${markdown}\n\`\`\``), false)).toEqual([
      "message",
      "turn-fold",
      "paper-proposal",
      "message",
    ]);
  });

  it("keeps the mounted card stable when unrelated tools update", () => {
    const entries = turn(proposeCall("completed", { structuredContent: { paperProposal } }));
    const row = deriveMessagesTimelineRows({
      timelineEntries: entries,
      isWorking: false,
      turnDiffSummaries: [],
      supportsConversationRollback: false,
    }).find((entry) => entry.kind === "paper-proposal")!;
    const first = computeStableMessagesTimelineRows([row], { byId: new Map(), result: [] });
    const equal = { ...row, paperProposal: { ...paperProposal } };
    expect(computeStableMessagesTimelineRows([equal], first)).toBe(first);
    expect(
      computeStableMessagesTimelineRows(
        [{ ...equal, paperProposal: { ...paperProposal, proposalId: "another" } }],
        first,
      ),
    ).not.toBe(first);
  });

  it.each([
    ["running", "running", undefined],
    ["failed", "failed", { content: [{ type: "text", text: "Invalid proposal" }], isError: true }],
    ["errored", "completed", { structuredContent: { paperProposal }, isError: true }],
  ] as const)("keeps a %s call in the work log", (_label, status, output) => {
    const entries = turn(proposeCall(status, output));
    expect(entries.some((entry) => entry.kind === "paper-proposal")).toBe(false);
    expect(entries.find((entry) => entry.id === "proposal")?.kind).toBe("work");
  });
});
