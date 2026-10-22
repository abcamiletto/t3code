import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { EnvironmentAuthorizationError } from "./auth.ts";
import { IsoDateTime, NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Paper: a live-compiled LaTeX document beside the chat. The environment that
 * owns the workspace (`cwd`, a project root or worktree) builds it; clients
 * only render it. File paths are relative to `cwd` with forward slashes.
 */

export const PaperDiagnostic = Schema.Struct({
  severity: Schema.Literals(["error", "warning"]),
  message: Schema.String,
  file: Schema.optionalKey(Schema.String),
  line: Schema.optionalKey(PositiveInt),
});
export type PaperDiagnostic = typeof PaperDiagnostic.Type;

/** A rectangle on a PDF page in PDF points, origin at the page's top-left corner. */
export const PaperPdfBox = Schema.Struct({
  page: PositiveInt,
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});
export type PaperPdfBox = typeof PaperPdfBox.Type;

export const PaperBuild = Schema.Struct({
  /** `unavailable`: Tectonic is not installed on the environment. */
  status: Schema.Literals(["idle", "building", "succeeded", "failed", "unavailable"]),
  /** Workspace-relative path of the newest PDF, kept when a later build produces none. */
  pdf: Schema.NullOr(Schema.String),
  /** Increments whenever `pdf` changes; clients reload on a new revision. */
  revision: NonNegativeInt,
  /** The last build failed before producing a PDF, so `pdf` predates the current sources. */
  outdated: Schema.Boolean,
  diagnostics: Schema.Array(PaperDiagnostic),
  durationMs: Schema.optionalKey(NonNegativeInt),
});
export type PaperBuild = typeof PaperBuild.Type;

export const PaperProposalOption = Schema.Struct({
  latex: Schema.String,
  note: Schema.optionalKey(Schema.String),
});
export type PaperProposalOption = typeof PaperProposalOption.Type;

/** `stale`: neither the original nor the applied text appears exactly once in the file. */
export const PaperProposalStatus = Schema.Literals(["pending", "applied", "dismissed", "stale"]);
export type PaperProposalStatus = typeof PaperProposalStatus.Type;

export const PaperProposal = Schema.Struct({
  id: TrimmedNonEmptyString,
  threadId: TrimmedNonEmptyString,
  file: Schema.String,
  original: Schema.String,
  options: Schema.Array(PaperProposalOption),
  summary: Schema.optionalKey(Schema.String),
  status: PaperProposalStatus,
  appliedOption: Schema.optionalKey(NonNegativeInt),
  /** Where the passage's current text sits in `file`. */
  startLine: PositiveInt,
  endLine: PositiveInt,
  /** Where the passage's current text renders in the current PDF. Empty when unknown. */
  boxes: Schema.Array(PaperPdfBox),
  createdAt: IsoDateTime,
});
export type PaperProposal = typeof PaperProposal.Type;

export const PaperState = Schema.Struct({
  cwd: Schema.String,
  /** `null` when the workspace root has no `.tex` file with `\documentclass`. */
  mainFile: Schema.NullOr(Schema.String),
  build: PaperBuild,
  /** Proposals made in the subscribed thread, oldest first. */
  proposals: Schema.Array(PaperProposal),
});
export type PaperState = typeof PaperState.Type;

export const PaperSubscribeInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  threadId: TrimmedNonEmptyString,
});
export type PaperSubscribeInput = typeof PaperSubscribeInput.Type;

export const PaperBuildInput = Schema.Struct({ cwd: TrimmedNonEmptyString });
export type PaperBuildInput = typeof PaperBuildInput.Type;

export const PaperPreviewInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  proposalId: TrimmedNonEmptyString,
  /** The option to typeset, or `null` for the original text. */
  option: Schema.NullOr(NonNegativeInt),
  /** The build the preview is based on; a newer build invalidates cached previews. */
  revision: NonNegativeInt,
});
export type PaperPreviewInput = typeof PaperPreviewInput.Type;

/** The whole document typeset with one choice, and where that choice renders. */
export const PaperPreview = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("ready"),
    pdf: Schema.String,
    boxes: Schema.Array(PaperPdfBox),
  }),
  Schema.Struct({
    status: Schema.Literal("failed"),
    diagnostics: Schema.Array(PaperDiagnostic),
  }),
]);
export type PaperPreview = typeof PaperPreview.Type;

export const PaperLocateSourceInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  /** The selected text's rectangles in the current PDF. */
  boxes: Schema.Array(PaperPdfBox).check(Schema.isMinLength(1)),
});
export type PaperLocateSourceInput = typeof PaperLocateSourceInput.Type;

export const PaperSourceRange = Schema.Struct({
  file: Schema.String,
  startLine: PositiveInt,
  endLine: PositiveInt,
  /** The source lines in the range. */
  source: Schema.String,
});
export type PaperSourceRange = typeof PaperSourceRange.Type;

export const PaperProposalAction = Schema.Union([
  Schema.Struct({ type: Schema.Literal("apply"), option: NonNegativeInt }),
  Schema.Struct({ type: Schema.Literal("dismiss") }),
  /** Restores the original text and makes the proposal pending again. */
  Schema.Struct({ type: Schema.Literal("reopen") }),
]);
export type PaperProposalAction = typeof PaperProposalAction.Type;

export const PaperResolveProposalInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  proposalId: TrimmedNonEmptyString,
  action: PaperProposalAction,
});
export type PaperResolveProposalInput = typeof PaperResolveProposalInput.Type;

/** What a `paper_propose_edits` tool call keeps in its output for the chat card. */
export const PaperProposalReference = Schema.Struct({
  cwd: Schema.String,
  proposalId: Schema.String,
});
export type PaperProposalReference = typeof PaperProposalReference.Type;

const PAPER_FAILURE_MESSAGES = {
  workspace_unavailable: "This workspace is not available.",
  no_document: "This workspace has no LaTeX document.",
  proposal_not_found: "This proposal no longer exists.",
  proposal_stale: "The passage changed in the file, so this proposal can no longer be applied.",
  invalid_option: "That option does not exist.",
  invalid_action: "This proposal is not in a state that allows that action.",
  original_not_found:
    "The original text must appear exactly once in the file. Copy it from the current source.",
  outside_workspace: "The file is outside the workspace.",
  sync_unavailable: "The current PDF has no source locations. Wait for the build to finish.",
  io_failed: "Could not read or write the paper files.",
} as const;

export const PaperFailureReason = Schema.Literals(
  Object.keys(PAPER_FAILURE_MESSAGES) as Array<keyof typeof PAPER_FAILURE_MESSAGES>,
);
export type PaperFailureReason = typeof PaperFailureReason.Type;

export class PaperError extends Schema.TaggedError<PaperError>()("PaperError", {
  reason: PaperFailureReason,
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message(): string {
    return PAPER_FAILURE_MESSAGES[this.reason];
  }
}

export const PAPER_WS_METHODS = {
  paperSubscribe: "paper.subscribe",
  paperBuild: "paper.build",
  paperPreview: "paper.preview",
  paperLocateSource: "paper.locateSource",
  paperResolveProposal: "paper.resolveProposal",
} as const;

const PaperRpcError = Schema.Union([PaperError, EnvironmentAuthorizationError]);

export const PaperRpcGroup = RpcGroup.make(
  Rpc.make(PAPER_WS_METHODS.paperSubscribe, {
    payload: PaperSubscribeInput,
    success: PaperState,
    error: PaperRpcError,
    stream: true,
  }),
  Rpc.make(PAPER_WS_METHODS.paperBuild, { payload: PaperBuildInput, error: PaperRpcError }),
  Rpc.make(PAPER_WS_METHODS.paperPreview, {
    payload: PaperPreviewInput,
    success: PaperPreview,
    error: PaperRpcError,
  }),
  Rpc.make(PAPER_WS_METHODS.paperLocateSource, {
    payload: PaperLocateSourceInput,
    success: PaperSourceRange,
    error: PaperRpcError,
  }),
  Rpc.make(PAPER_WS_METHODS.paperResolveProposal, {
    payload: PaperResolveProposalInput,
    success: PaperProposal,
    error: PaperRpcError,
  }),
);
