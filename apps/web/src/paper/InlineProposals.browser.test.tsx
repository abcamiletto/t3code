import { EnvironmentId, ThreadId, type PaperProposal } from "@t3tools/contracts";
import * as ProposalLinks from "@t3tools/shared/paperProposalLinks";
import { Atom } from "effect/reactivity";
import { render } from "../../test/render";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import "../index.css";

const fixture = vi.hoisted(() => ({
  proposals: [] as PaperProposal[],
  resolve: vi.fn(),
}));

vi.mock(import("../state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: (() => ({
    data: { proposals: fixture.proposals, build: { revision: 0 }, pdf: null, diagnostics: [] },
  })) as never,
}));
vi.mock(import("../state/use-atom-command"), async (original) => {
  const actual = await original();
  const { paperEnvironment } = await import("./state");
  return {
    ...actual,
    useAtomCommand: ((command, options) =>
      command === (paperEnvironment.resolveProposal as unknown)
        ? fixture.resolve
        : actual.useAtomCommand(command, options)) as typeof actual.useAtomCommand,
  };
});
vi.mock(import("../state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const noConfig = Atom.make(null);
  return {
    ...actual,
    serverEnvironment: { ...actual.serverEnvironment, configValueAtom: (() => noConfig) as never },
  };
});

import ChatMarkdown from "../components/ChatMarkdown";
import { paperEnvironment } from "./state";
import { usePaperReveal } from "./openPaperPanel";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";

it("places multiple option cards between paragraphs and applies the chosen option", async () => {
  const threadRef = {
    environmentId: EnvironmentId.make("paper-test"),
    threadId: ThreadId.make("paper-thread"),
  };
  fixture.proposals = ["Refinement loop", "Training losses"].map((summary, index) => ({
    id: `proposal-${index}`,
    threadId: threadRef.threadId,
    file: "main.tex",
    original: "Original sentence.",
    startLine: index + 1,
    endLine: index + 1,
    summary,
    options: [{ latex: "First option." }, { latex: "Second option." }],
    status: "pending",
    boxes: [],
    createdAt: "2026-10-19T00:00:00.000Z",
  }));
  fixture.resolve.mockImplementation(async ({ input }) => ({
    _tag: "Success",
    value: {
      ...fixture.proposals.find((proposal) => proposal.id === input.proposalId),
      status: "applied",
      appliedOptionIndex: input.resolution.optionIndex,
    },
  }));
  using _permission = vi
    .spyOn(paperEnvironment.resolveProposal, "permissionAtom")
    .mockReturnValue(Atom.make(true));
  const container = document.body.appendChild(document.createElement("div"));
  container.style.width = "600px";

  const links = fixture.proposals.map((proposal) =>
    ProposalLinks.formatPaperProposalLink({ cwd: "/paper", proposalId: proposal.id }),
  );
  await using _screen = await render(
    <ChatMarkdown
      threadRef={threadRef}
      cwd="/paper"
      text={`Refine the loop.\n\n${links[0]}\n\nShorten the losses.\n\n${links[1]}\n\nChoose whichever reads best.`}
    />,
    { container },
  );
  await vi.waitFor(() =>
    expect(container.querySelectorAll('[aria-label="Proposed text"]')).toHaveLength(2),
  );
  const markdown = container.querySelector(".chat-markdown")!;
  expect([...markdown.children].map((child) => child.textContent)).toEqual([
    "Refine the loop.",
    expect.stringContaining("Refinement loop"),
    "Shorten the losses.",
    expect.stringContaining("Training losses"),
    "Choose whichever reads best.",
  ]);
  expect(container.querySelector("p .not-prose")).toBeNull();
  const heading = container.querySelector<HTMLElement>('[aria-label="Proposed text"] h3')!;
  expect(getComputedStyle(heading).fontSize).toBe("12px");
  expect(getComputedStyle(heading).marginTop).toBe("0px");
  await userEvent.click(page.getByRole("button", { name: "Option B", exact: true }).first());
  await userEvent.click(page.getByRole("button", { name: "Apply option B", exact: true }));
  expect(fixture.resolve).toHaveBeenCalledWith({
    environmentId: threadRef.environmentId,
    input: {
      cwd: "/paper",
      proposalId: "proposal-0",
      resolution: { type: "apply", optionIndex: 1 },
    },
  });
  expect(container.textContent).toContain("Refinement loopapplied");
  await userEvent.click(page.getByRole("button", { name: "Refinement loop", exact: true }));
  await userEvent.click(page.getByRole("button", { name: "Option A", exact: true }).first());
  expect(container.querySelector('[aria-label="Proposed text"] h3')?.textContent).toContain(
    "Option A",
  );
  await expect
    .element(page.getByRole("button", { name: "Apply option A", exact: true }).first())
    .toBeDisabled();
  expect(fixture.resolve).toHaveBeenCalledTimes(1);
  await userEvent.click(page.getByRole("button", { name: "View in PDF", exact: true }).first());
  expect(usePaperReveal.getState().requests[scopedThreadKey(threadRef)]?.proposalId).toBe(
    "proposal-0",
  );
});
