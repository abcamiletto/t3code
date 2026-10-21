import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ProjectId, ThreadId, type OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProcessRunner from "../processRunner.ts";
import { PaperToolkit } from "../mcp/toolkits/paper/tools.ts";
import * as PaperMcpService from "./PaperMcpService.ts";
import * as PaperService from "./PaperService.ts";
import * as ProposalLinks from "@t3tools/shared/paperProposalLinks";

const encodeStatus = Schema.encodeEffect(PaperToolkit.tools.paper_status.successSchema);
const decodeProposal = Schema.decodeEffect(PaperToolkit.tools.paper_propose_edits.parametersSchema);

it.effect(
  "requires at least two alternatives for approval and returns the last five resolutions without chat chips",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "paper-mcp-test-" });
      yield* fs.writeFileString(
        path.join(cwd, "main.tex"),
        `\\documentclass{article}\n${Array.from({ length: 8 }, (_, index) => `Sentence ${index}.`).join("\n")}\n`,
      );
      const threadId = ThreadId.make("paper-thread");
      const projectId = ProjectId.make("paper-project");
      const dependencies = Layer.mergeAll(
        Layer.mock(ThreadManagementService.ThreadManagementService)({
          getThreadShell: () =>
            Effect.succeed({ projectId, worktreePath: cwd } as OrchestrationV2ThreadShell),
        }),
        Layer.mock(ProjectService.ProjectService)({
          getById: () =>
            Effect.succeedSome({
              id: projectId,
              title: "Paper",
              workspaceRoot: "/unused-project-root",
              defaultModelSelection: null,
              scripts: [],
              createdAt: "2026-10-17T00:00:00.000Z",
              updatedAt: "2026-10-17T00:00:00.000Z",
              deletedAt: null,
            }),
        }),
        PaperService.layer.pipe(
          Layer.provide(
            Layer.succeed(ProcessRunner.ProcessRunner, {
              run: () =>
                Effect.succeed({
                  code: ChildProcessSpawner.ExitCode(1),
                  stdout: "",
                  stderr: "error: main.tex:2: Undefined control sequence.",
                  timedOut: false,
                  stdoutTruncated: false,
                  stderrTruncated: false,
                  stdoutInvalidUtf8: false,
                  stderrInvalidUtf8: false,
                }),
            }),
          ),
        ),
      );
      const layer = PaperMcpService.layer.pipe(Layer.provideMerge(dependencies));
      yield* Effect.gen(function* () {
        const mcp = yield* PaperMcpService.PaperMcpService;
        const paper = yield* PaperService.PaperService;
        expect(
          yield* decodeProposal({
            file: "main.tex",
            original: "Sentence 0.",
            options: [{ latex: "A clearer sentence." }],
          }).pipe(Effect.exit),
        ).toMatchObject({ _tag: "Failure" });
        const proposals = yield* Effect.forEach(
          Array.from({ length: 8 }, (_, index) => index),
          (index) =>
            Effect.gen(function* () {
              const input = yield* decodeProposal({
                file: "main.tex",
                original: `Sentence ${index}.`,
                options: [{ latex: "A clearer sentence." }, { latex: "A shorter sentence." }],
                ...(index === 0 ? { summary: "Tighten this sentence" } : {}),
              });
              return yield* mcp.propose(threadId, input);
            }),
        );
        expect(ProposalLinks.inlinePaperProposalReferences(proposals[0]!.markdown)).toEqual([
          proposals[0]!.paperProposal,
        ]);
        for (const { paperProposal } of proposals.slice(1, 7).toReversed()) {
          yield* paper.resolve({
            cwd,
            proposalId: paperProposal.proposalId,
            resolution: { type: "dismiss" },
          });
        }
        yield* paper.resolve({
          cwd,
          proposalId: proposals[0]!.paperProposal.proposalId,
          resolution: { type: "apply", optionIndex: 0 },
        });
        expect(yield* fs.readFileString(path.join(cwd, "main.tex"))).toContain(
          "A clearer sentence.",
        );
        const otherThread = ThreadId.make("other-paper-thread");
        const otherProposal = yield* mcp.propose(otherThread, {
          file: "main.tex",
          original: "Sentence 7.",
          options: [{ latex: "Another wording." }, { latex: "A different wording." }],
        });
        const otherResolution = yield* paper.propose({
          cwd,
          file: "main.tex",
          original: "Sentence 6.",
          options: [{ latex: "Another wording." }, { latex: "A different wording." }],
          threadId: otherThread,
        });
        yield* paper.resolve({
          cwd,
          proposalId: otherResolution.id,
          resolution: { type: "dismiss" },
        });
        const otherStatus = yield* mcp.status(otherThread);
        expect(otherStatus.proposals.map(({ id }) => id)).toEqual([
          otherProposal.paperProposal.proposalId,
        ]);
        expect(otherStatus.resolvedProposals.map(({ id }) => id)).toEqual([otherResolution.id]);
        const status = yield* mcp.status(threadId);
        expect(status.buildStatus).toBe("failed");
        expect(status.diagnostics[0]).toMatchObject({ file: "main.tex", line: 2 });
        expect(status.proposals.map(({ id }) => id)).toEqual([
          proposals[7]!.paperProposal.proposalId,
        ]);
        expect(status.resolvedProposals).toEqual([
          {
            id: proposals[0]!.paperProposal.proposalId,
            file: "main.tex",
            summary: "Tighten this sentence",
            status: "applied",
            appliedOptionIndex: 0,
          },
          ...proposals.slice(1, 5).map(({ paperProposal }) => ({
            id: paperProposal.proposalId,
            file: "main.tex",
            status: "dismissed",
          })),
        ]);
        const encoded = yield* encodeStatus(status);
        expect(encoded.resolvedProposals).toEqual(status.resolvedProposals);
        const restarted = yield* Effect.gen(function* () {
          const mcp = yield* PaperMcpService.PaperMcpService;
          return yield* mcp.status(threadId);
        }).pipe(Effect.provide(Layer.fresh(layer)));
        expect(restarted.resolvedProposals).toEqual(status.resolvedProposals);
      }).pipe(Effect.provide(layer));
    }).pipe(Effect.provide(NodeServices.layer)),
);
