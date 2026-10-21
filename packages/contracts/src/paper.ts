import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Paper: a live-compiled LaTeX workspace. State is keyed by the workspace root
 * (`cwd`, a project root or worktree) and owned by the environment; clients
 * only render it. Paths are relative to `cwd` with forward slashes.
 */

const PAPER_FAILURE_MESSAGES = {
  not_latex: "This workspace has no LaTeX document.",
  compiler_missing:
    "Tectonic is not installed. Install it with `brew install tectonic` on the machine that owns this project.",
  workspace_unavailable: "This workspace is not available.",
  proposal_not_found: "This proposal no longer exists.",
  proposal_resolved: "This proposal was already resolved.",
  proposal_stale: "The original text changed, so this option can no longer be applied.",
  invalid_option: "That option does not exist.",
  original_not_found: "The original text does not appear exactly once in the file.",
  sync_unavailable: "No SyncTeX data for the current build.",
  synctex_missing:
    "Source navigation needs the synctex command. Install TeX Live or MiKTeX on the machine that owns this project.",
  io_failed: "Could not read or write the paper files.",
} as const;

export const PaperFailureReason = Schema.Literals(
  Object.keys(PAPER_FAILURE_MESSAGES) as Array<keyof typeof PAPER_FAILURE_MESSAGES>,
);
export type PaperFailureReason = typeof PaperFailureReason.Type;

export const PaperBuildStatus = Schema.Literals(["idle", "building", "succeeded", "failed"]);
export type PaperBuildStatus = typeof PaperBuildStatus.Type;

export const PaperDiagnostic = Schema.Struct({
  severity: Schema.Literals(["error", "warning"]),
  message: Schema.String,
  file: Schema.optionalKey(Schema.String),
  line: Schema.optionalKey(PositiveInt),
  /** Set when the build failed before the compiler ran, e.g. `compiler_missing`. */
  code: Schema.optionalKey(PaperFailureReason),
});
export type PaperDiagnostic = typeof PaperDiagnostic.Type;

/** A rectangle on a PDF page in PDF points (1/72 in), origin at the page's top-left. */
export const PaperPdfBox = Schema.Struct({
  page: PositiveInt,
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});
export type PaperPdfBox = typeof PaperPdfBox.Type;

export const PaperBuild = Schema.Struct({
  status: PaperBuildStatus,
  /** Increments on every successful build; clients use it to reload the PDF. */
  revision: NonNegativeInt,
  /** The last successfully built PDF, kept while a newer build runs or fails. */
  pdfPath: Schema.NullOr(Schema.String),
  finishedAt: Schema.optionalKey(IsoDateTime),
  durationMs: Schema.optionalKey(NonNegativeInt),
  diagnostics: Schema.Array(PaperDiagnostic),
});
export type PaperBuild = typeof PaperBuild.Type;

export const PaperProposalOption = Schema.Struct({
  latex: Schema.String,
  note: Schema.optionalKey(Schema.String),
});
export type PaperProposalOption = typeof PaperProposalOption.Type;

/** `stale`: the original text no longer appears in the file, so no option can be applied. */
export const PaperProposalStatus = Schema.Literals(["pending", "applied", "dismissed", "stale"]);
export type PaperProposalStatus = typeof PaperProposalStatus.Type;

export const PaperProposal = Schema.Struct({
  id: TrimmedNonEmptyString,
  threadId: Schema.optionalKey(TrimmedNonEmptyString),
  file: Schema.String,
  /** Exact source text the options replace. */
  original: Schema.String,
  startLine: PositiveInt,
  endLine: PositiveInt,
  summary: Schema.optionalKey(Schema.String),
  options: Schema.Array(PaperProposalOption),
  status: PaperProposalStatus,
  appliedOptionIndex: Schema.optionalKey(NonNegativeInt),
  /** Where `original` renders in the current PDF, from SyncTeX. Empty when unknown. */
  boxes: Schema.Array(PaperPdfBox),
  createdAt: IsoDateTime,
});
export type PaperProposal = typeof PaperProposal.Type;

export const PaperState = Schema.Struct({
  cwd: Schema.String,
  isLatex: Schema.Boolean,
  mainFile: Schema.NullOr(Schema.String),
  preview: Schema.Struct({
    preamble: Schema.String,
    error: Schema.NullOr(Schema.String),
  }),
  build: PaperBuild,
  proposals: Schema.Array(PaperProposal),
});
export type PaperState = typeof PaperState.Type;

export const PaperWorkspaceInput = Schema.Struct({ cwd: TrimmedNonEmptyString });
export type PaperWorkspaceInput = typeof PaperWorkspaceInput.Type;

/** A point on a rendered page, in the same units as `PaperPdfBox`. */
export const PaperSyncFromPdfInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  page: PositiveInt,
  x: Schema.Number,
  y: Schema.Number,
  /** The selected text, used to narrow the SyncTeX hit to the exact source lines. */
  text: Schema.optionalKey(Schema.String),
});
export type PaperSyncFromPdfInput = typeof PaperSyncFromPdfInput.Type;

export const PaperSourceRange = Schema.Struct({
  file: Schema.String,
  startLine: PositiveInt,
  endLine: PositiveInt,
  /** The source lines in the range, for the comment the agent receives. */
  source: Schema.String,
});
export type PaperSourceRange = typeof PaperSourceRange.Type;

export const PaperResolveProposalInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  proposalId: TrimmedNonEmptyString,
  resolution: Schema.Union([
    Schema.Struct({ type: Schema.Literal("apply"), optionIndex: NonNegativeInt }),
    Schema.Struct({ type: Schema.Literal("dismiss") }),
  ]),
});
export type PaperResolveProposalInput = typeof PaperResolveProposalInput.Type;

/** What a `paper_propose_edits` tool call keeps in its compact output for the chat card. */
export const PaperProposalReference = Schema.Struct({
  cwd: Schema.String,
  proposalId: Schema.String,
});
export type PaperProposalReference = typeof PaperProposalReference.Type;

export class PaperError extends Schema.TaggedError<PaperError>()("PaperError", {
  reason: PaperFailureReason,
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message(): string {
    return PAPER_FAILURE_MESSAGES[this.reason];
  }
}
