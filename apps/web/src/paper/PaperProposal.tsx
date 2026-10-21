import type { PaperProposalReference, ScopedThreadRef } from "@t3tools/contracts";
import * as ProposalLinks from "@t3tools/shared/paperProposalLinks";
import type { ExtraProps } from "react-markdown";
import { lazy, Suspense, type ReactNode } from "react";
import { openPaperPanel } from "./openPaperPanel";

const PaperProposalRow = lazy(() => import("./PaperProposalRow"));

export function PaperProposal({
  reference,
  threadRef,
}: {
  reference: PaperProposalReference;
  threadRef: ScopedThreadRef | null;
}) {
  return (
    threadRef && (
      <Suspense fallback={null}>
        <PaperProposalRow threadRef={threadRef} reference={reference} />
      </Suspense>
    )
  );
}

export function renderPaperProposalParagraph(
  node: ExtraProps["node"],
  threadRef: ScopedThreadRef | null,
) {
  const only = node?.children.length === 1 ? node.children[0] : undefined;
  const href = only?.type === "element" && only.tagName === "a" ? only.properties.href : undefined;
  const reference =
    typeof href === "string" ? ProposalLinks.parsePaperProposalHref(href) : undefined;
  return reference && threadRef ? (
    <div className="my-3 not-prose">
      <PaperProposal threadRef={threadRef} reference={reference} />
    </div>
  ) : null;
}

export function renderPaperProposalLink(
  href: string | undefined,
  children: ReactNode,
  threadRef: ScopedThreadRef | null,
) {
  const reference = href ? ProposalLinks.parsePaperProposalHref(href) : undefined;
  return reference ? (
    <button
      type="button"
      onClick={() => threadRef && openPaperPanel(threadRef, { proposalId: reference.proposalId })}
    >
      {children}
    </button>
  ) : null;
}
