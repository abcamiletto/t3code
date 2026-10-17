import { expect, it } from "vite-plus/test";
import { summarizeT3ToolCalls } from "./t3ToolSummary.ts";

it("summarizes Paper status and counts proposed alternatives", () => {
  expect(
    summarizeT3ToolCalls("paper-status", [{ input: {}, output: {}, outcome: "completed" }]),
  ).toEqual({ label: "Checked the paper build", failedCount: 0 });
  expect(
    summarizeT3ToolCalls("paper-propose", [
      {
        input: { options: [{ latex: "one" }, { latex: "two" }, { latex: "three" }] },
        output: {},
        outcome: "completed",
      },
    ]),
  ).toEqual({ label: "Proposed 3 rewrites", failedCount: 0 });
});
