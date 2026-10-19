# Paper

Paper shows a live PDF of a LaTeX project next to the chat and lets you review it with the agent.

## Start

A project with a `.tex` file in its root shows a TeX icon. Open the right panel and choose
**Paper**. The project builds with [Tectonic](https://tectonic-typesetting.github.io)
(`brew install tectonic`) and rebuilds whenever a `.tex`, `.bib`, style or image file changes.
Build output goes to `.t3-paper/`, which ignores itself in Git.

## Use your existing T3 Code machines

On macOS, Paper picks up the account and saved machine connections from a standard T3 Code
installation. Allow Keychain access if macOS asks. Work in the same connected machine in both
apps to see the same projects and chats. Paper starts with its own local environment disabled
after importing; you can enable it in Settings → Connections if you need a separate local workspace.

PDF builds and paper proposals require the T3 Paper server on the machine that owns the project.
Connecting to a standard T3 Code server shares its chats but does not add the paper tools there.

## Comment on the paper

Select text in the PDF and click the comment button. The comment is added to your message with
the matching `.tex` lines, the same way a code review comment is. Send it to ask the agent for
changes.

Each comment includes the exact PDF text you selected as well as the matching source context,
so short instructions such as "delete this part" retain their target.

## Pick a rewrite

When you comment on wording, the agent proposes two to four alternatives instead of editing the
file. They are highlighted on the PDF and shown in the chat.

Use **View in PDF** on a proposal to jump to the passage, highlight it, and open the alternatives
beside it. New proposals open there automatically while you are working in Paper. If the passage
cannot be located in the current PDF, the proposal stays available in the chat.

The popup shows the original and one selected alternative side by side. Switch options at the top;
long passages scroll inside each text pane. Red marks the original; green marks the proposed text.

- Click an option and **Apply** it. The `.tex` file is updated and the PDF rebuilds. Your next
  message tells the agent which option you chose.
- Type in **Reply** to send feedback; the agent answers with revised options.
- Dismiss a proposal you don't want.

A proposal goes stale if its original text changes before you apply it.

## Agent tools

Agents can call `paper_status` to rebuild and read compile errors, and `paper_propose_edits` to
offer alternatives.
