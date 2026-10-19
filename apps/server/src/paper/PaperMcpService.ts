import {
  OrchestratorMcpFailure,
  type PaperBuildStatus,
  type PaperDiagnostic,
  type PaperProposal,
  type PaperProposalReference,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as ProposalLinks from "@t3tools/shared/paperProposalLinks";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { unavailable } from "../mcp/threadAccess.ts";
import * as PaperService from "./PaperService.ts";

type ProposalInput = Omit<
  Parameters<PaperService.PaperService["Service"]["propose"]>[0],
  "cwd" | "threadId"
>;

export class PaperMcpService extends Context.Service<
  PaperMcpService,
  {
    readonly status: (threadId: ThreadId) => Effect.Effect<
      {
        mainFile: string | null;
        buildStatus: PaperBuildStatus;
        diagnostics: ReadonlyArray<PaperDiagnostic>;
        pdfPath: string | null;
        proposals: ReadonlyArray<
          Pick<PaperProposal, "id" | "file" | "startLine" | "endLine" | "summary">
        >;
        resolvedProposals: ReadonlyArray<
          Pick<PaperProposal, "id" | "file" | "summary" | "status" | "appliedOptionIndex">
        >;
      },
      OrchestratorMcpFailure
    >;
    readonly propose: (
      threadId: ThreadId,
      input: ProposalInput,
    ) => Effect.Effect<
      { paperProposal: PaperProposalReference; markdown: string; message: string },
      OrchestratorMcpFailure
    >;
  }
>()("t3/paper/PaperMcpService") {}

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const projects = yield* ProjectService.ProjectService;
  const paper = yield* PaperService.PaperService;
  const toFailure = (error: { readonly message: string }) =>
    new OrchestratorMcpFailure({ code: "invalid_request", message: error.message });
  const callingWorkspace = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const thread = yield* threads.getThreadShell(threadId).pipe(Effect.mapError(unavailable));
      if (thread === null)
        return yield* new OrchestratorMcpFailure({
          code: "thread_not_found",
          message: "The calling thread was not found.",
        });
      const project = yield* projects.getById(thread.projectId).pipe(Effect.mapError(unavailable));
      if (Option.isNone(project))
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "The project was not found.",
        });
      return { cwd: thread.worktreePath ?? project.value.workspaceRoot, threadId };
    });

  return PaperMcpService.of({
    status: (threadId) =>
      Effect.gen(function* () {
        const { cwd } = yield* callingWorkspace(threadId);
        const state = yield* paper.currentStatus(cwd).pipe(Effect.mapError(toFailure));
        const proposals = state.proposals.filter((proposal) => proposal.threadId === threadId);
        return {
          mainFile: state.mainFile,
          buildStatus: state.build.status,
          diagnostics: [...state.build.diagnostics]
            .sort((a, b) => Number(b.severity === "error") - Number(a.severity === "error"))
            .slice(0, 20),
          pdfPath: state.build.pdfPath,
          proposals: proposals
            .filter((proposal) => proposal.status === "pending")
            .map(({ id, file, startLine, endLine, summary }) => ({
              id,
              file,
              startLine,
              endLine,
              ...(summary === undefined ? {} : { summary }),
            })),
          resolvedProposals: proposals
            .filter((proposal) => proposal.status !== "pending")
            .slice(-5)
            .toReversed()
            .map(({ id, file, summary, status, appliedOptionIndex }) => ({
              id,
              file,
              ...(summary === undefined ? {} : { summary }),
              status,
              ...(appliedOptionIndex === undefined ? {} : { appliedOptionIndex }),
            })),
        };
      }),
    propose: (threadId, input) =>
      Effect.gen(function* () {
        const workspace = yield* callingWorkspace(threadId);
        const proposal = yield* paper
          .propose({ ...workspace, ...input })
          .pipe(Effect.mapError(toFailure));
        const reference = { cwd: workspace.cwd, proposalId: proposal.id };
        return {
          paperProposal: reference,
          markdown: ProposalLinks.formatPaperProposalLink(reference),
          message:
            "Put the returned markdown in its own paragraph (blank lines before and after), exactly where these options belong in your reply. It renders the interactive proposal card. Keep surrounding prose brief; do not repeat the options or describe where to find them.",
        };
      }),
  });
});

export const layer = Layer.effect(PaperMcpService, make);
