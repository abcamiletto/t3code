import { expect, it } from "vite-plus/test";

import { compactDynamicToolOutput, paperProposalFromToolItem } from "./toolOutput.ts";

it("retains only the proposal reference through provider MCP output compaction", () => {
  const reference = { cwd: "/workspace", proposalId: "proposal-1" };
  const providerOutput = {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          paperProposal: { ...reference, privateData: "discard" },
          message: "Shown in the panel",
        }),
      },
    ],
  };
  const compact = compactDynamicToolOutput(providerOutput);
  expect(compact).toEqual({ paperProposal: reference });
  expect(
    paperProposalFromToolItem({ toolName: "mcp__t3-code__paper_propose_edits", output: compact }),
  ).toEqual(reference);
  expect(paperProposalFromToolItem({ toolName: "another_tool", output: compact })).toBeUndefined();
  expect(
    paperProposalFromToolItem({
      toolName: "paper_propose_edits",
      output: { ...providerOutput, isError: true },
    }),
  ).toBeUndefined();
});

it("drops malformed and oversized proposal metadata", () => {
  expect(compactDynamicToolOutput({ paperProposal: { cwd: "/workspace" } })).toBeUndefined();
  expect(
    compactDynamicToolOutput({ paperProposal: { cwd: "x".repeat(5000), proposalId: "proposal" } }),
  ).toBeUndefined();
  expect(
    compactDynamicToolOutput({ paperProposal: { cwd: "/workspace", proposalId: 2 } }),
  ).toBeUndefined();
});
