# Paper

Paper shows a live PDF of a LaTeX project next to the chat and lets you review it with the agent.

## Start

A project with a `.tex` file in its root shows a TeX icon. Open the right panel and choose
**Paper**. The project builds with [Tectonic](https://tectonic-typesetting.github.io)
(`brew install tectonic`) and rebuilds whenever a `.tex`, `.bib`, style or image file changes.
Build output goes to `.t3-paper/`, which ignores itself in Git.

## Comment on the paper

Select text in the PDF and click the comment button. The comment is added to your message with
the matching `.tex` lines, the same way a code review comment is. Send it to ask the agent for
changes.

## Pick a rewrite

When you comment on wording, the agent proposes two to four alternatives instead of editing the
file. They are highlighted on the PDF and shown in the chat.

- Click an option and **Apply** it. The `.tex` file is updated and the PDF rebuilds. Your next
  message tells the agent which option you chose.
- Type in **Reply** to send feedback; the agent answers with revised options.
- Dismiss a proposal you don't want.

A proposal goes stale if its original text changes before you apply it.

## Agent tools

Agents can call `paper_status` to rebuild and read compile errors, and `paper_propose_edits` to
offer alternatives.
