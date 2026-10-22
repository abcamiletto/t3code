# Paper

Paper shows the live PDF of a LaTeX project beside the chat. You comment on the PDF, the agent
proposes rewrites, and you compare them typeset in the paper before applying one.

## Start

Open the right panel and choose **Paper**. Paper builds the `.tex` file in the workspace root that
contains `\documentclass` (`main.tex` when there are several) and rebuilds whenever a source,
bibliography, style or image file changes.

Paper builds with [Tectonic](https://tectonic-typesetting.github.io/), which fetches LaTeX
packages on demand and runs BibTeX itself. Install it on the machine that runs the project
(`brew install tectonic` on macOS). A `Tectonic.toml` in the workspace root selects Tectonic's
project build, so its bundle and inputs apply. Build output goes to `.t3-paper/`, which Git
ignores.

When a build fails, the panel says so and lists the errors; click a file name to open the source
at that line. If the build produced no PDF, the panel keeps showing the previous one and says that
it is out of date.

## Comment on the paper

Select text in the PDF and type your comment in the box that opens; press Enter to add it to your
message. Paper finds the matching source lines and includes them and the selected text. Send the
message to ask the agent for changes. The selection stays highlighted while the comment is in your
draft. Escape closes the box; a click elsewhere closes it only while it is empty.

## Choose a rewrite

The agent edits precise requests directly. For open-ended feedback, such as "this is awkward", it
proposes two to four rewrites, which appear in the chat as a card showing each option's changes.

Click **Show in paper** to review a proposal in the PDF. Switch between **Original** and the
options with the buttons or the arrow keys; each option is typeset in the whole document, so you
see its real line breaks, references and page layout. The passage stays in place on screen while
you switch. While the agent keeps working, the option you are looking at stays on screen until
the paper's new version is typeset. New proposals never interrupt a review: **Review** in the
toolbar and the blue marks in the PDF margin open them.

- **Apply** writes the option to the source file. Applying another option replaces it; **Undo**
  restores the original text.
- **Dismiss** hides a proposal; **Restore** brings it back.
- **Reply** adds feedback on the proposal to your message, with all its options. Send it, and the
  agent answers with revised options that replace the pending ones.

A proposal follows the file: if you undo an applied option in your editor, it is pending again.
If its text changes, it can no longer be applied.

## Agent tools

Agents call `paper_status` to build the paper and read its errors, and `paper_propose_edits` to
offer rewrites.
