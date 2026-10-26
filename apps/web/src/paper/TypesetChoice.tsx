import type { PaperChoicePage, PaperProposal, ScopedThreadRef } from "@t3tools/contracts";
import type { RenderTask } from "pdfjs-dist";
import { useEffect, useRef } from "react";

import { useEnvironmentQuery } from "~/state/query";
import { usePaperDocument, usePaperFileUrl, type PaperDocument } from "./pdfDocument";
import { choiceLabel, choiceText, ProposalDiff } from "./ProposalParts";
import type { PaperChoice } from "./review";
import { paperEnvironment } from "./state";

// Body text near the chat's own size: 10 pt at 1.5 px per point.
const SCALE = 1.5;

/**
 * A choice as the paper typesets it: a page cut to its text, made with the paper's preamble when
 * the agent proposed it. It shows the source diff when there is nothing to typeset.
 */
export function TypesetChoice(props: {
  readonly threadRef: ScopedThreadRef;
  readonly cwd: string;
  readonly proposal: PaperProposal;
  readonly choice: PaperChoice;
}) {
  const { threadRef, cwd, proposal, choice } = props;
  const typeset = useEnvironmentQuery(
    paperEnvironment.typesetProposal({
      environmentId: threadRef.environmentId,
      input: { cwd, proposalId: proposal.id },
    }),
  );
  const ready = typeset.data?.status === "ready" ? typeset.data : null;
  // Each file is written once, so it needs no cache-busting revision.
  const url = usePaperFileUrl(threadRef, cwd, threadRef, ready?.pdf ?? null, 0);
  const { document, failed } = usePaperDocument(url);
  // The diff stays, dimmed, until the choices are typeset.
  if (!typeset.data && !typeset.error)
    return (
      <div aria-busy className="opacity-50">
        <ProposalDiff proposal={proposal} choice={choice} />
      </div>
    );
  const index = choice === null ? 0 : choice + 1;
  const page = ready?.pages[index];
  if (!page || failed || !choiceText(proposal, choice).trim() || page.error)
    return (
      <>
        <ProposalDiff proposal={proposal} choice={choice} />
        {page?.error ? (
          <p className="text-xs text-destructive">
            {choiceLabel(choice)} does not compile: {page.error}
          </p>
        ) : null}
      </>
    );
  return (
    <ChoicePage
      document={document?.url === url ? document : null}
      number={index + 1}
      page={page}
      label={`${choiceLabel(choice)}, typeset`}
    />
  );
}

/** One page, sized before the document loads and painted offscreen, so it never flashes. */
function ChoicePage(props: {
  readonly document: PaperDocument | null;
  readonly number: number;
  readonly page: PaperChoicePage;
  readonly label: string;
}) {
  const { document, number, page } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // oxlint-disable-next-line t3code/react-effect-budget -- PDF.js paints the canvas asynchronously and must cancel rendering on unmount.
  useEffect(() => {
    if (document === null) return;
    let cancelled = false;
    let render: RenderTask | undefined;
    void document.pdf.getPage(number).then(async (proxy) => {
      if (cancelled) return;
      const viewport = proxy.getViewport({ scale: SCALE });
      const ratio = window.devicePixelRatio || 1;
      const offscreen = window.document.createElement("canvas");
      offscreen.width = Math.ceil(viewport.width * ratio);
      offscreen.height = Math.ceil(viewport.height * ratio);
      render = proxy.render({ canvas: offscreen, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
      await render.promise.catch(() => undefined);
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      canvas.width = offscreen.width;
      canvas.height = offscreen.height;
      canvas.getContext("2d")?.drawImage(offscreen, 0, 0);
    });
    return () => {
      cancelled = true;
      render?.cancel();
    };
  }, [document, number]);
  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={props.label}
      className="block h-auto max-w-full rounded-sm bg-white"
      style={{ width: page.width * SCALE, aspectRatio: `${page.width} / ${page.height}` }}
    />
  );
}
