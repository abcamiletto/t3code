import type { PaperProposalReference } from "@t3tools/contracts";
import type { Nodes } from "mdast";
import remarkParse from "remark-parse";
import * as Unified from "unified";
import { readPaperProposalReference } from "./paperProposal.ts";

export const PAPER_PROPOSAL_PROTOCOL = "t3-paper";
const prefix = `${PAPER_PROPOSAL_PROTOCOL}://v1/proposal/`;
const parser = Unified.unified().use(remarkParse);

export function formatPaperProposalLink(reference: PaperProposalReference): string {
  const url = new URL(`${prefix}${encodeURIComponent(reference.proposalId)}`);
  url.searchParams.set("cwd", reference.cwd);
  return `[Review options](${url.href})`;
}

export function parsePaperProposalHref(href: string): PaperProposalReference | undefined {
  if (!href.startsWith(prefix)) return;
  try {
    const url = new URL(href);
    const proposalId = decodeURIComponent(url.pathname.slice("/proposal/".length));
    const cwd = url.searchParams.get("cwd");
    if (!cwd || !proposalId || proposalId.includes("/")) return;
    return readPaperProposalReference({ cwd, proposalId });
  } catch {
    return undefined;
  }
}

export function inlinePaperProposalReferences(markdown: string): PaperProposalReference[] {
  if (!markdown.includes(prefix)) return [];
  const references: PaperProposalReference[] = [];
  const visit = (node: Nodes) => {
    if (node.type === "paragraph" && node.children.length === 1) {
      const link = node.children[0];
      const reference = link?.type === "link" ? parsePaperProposalHref(link.url) : undefined;
      if (reference) references.push(reference);
    }
    if ("children" in node) node.children.forEach(visit);
  };
  visit(parser.parse(markdown));
  return references;
}
