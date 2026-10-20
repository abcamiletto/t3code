# Paper

Paper shows a live PDF of a LaTeX project next to the chat and lets you review it with the agent.

## Start

A project with a `.tex` file in its root shows a TeX icon. Open the right panel and choose
**Paper**. Install [Tectonic](https://tectonic-typesetting.github.io/) on the machine that owns
the project (`brew install tectonic` on macOS). The project rebuilds whenever a `.tex`, `.bib`,
style or image file changes.
Font substitutions fail the build because they can remove italics or bold text. A failed build
keeps the previous PDF and shows a visible error; it does not mean your latest edits are displayed.
Build output goes to `.t3-paper/`, which ignores itself in Git.

Paper honors a root `Tectonic.toml` and builds the output named after the main file (`main` for
`main.tex`). Enable `synctex = true` in that output for PDF/source navigation. Ignore `build/` in Git.
Compiler settings belong in this configuration; conference templates can stay unchanged.
For legacy Times templates such as CVPR, use a build-only input before the unchanged document:

```toml
[[output]]
name = "main"
type = "pdf"
synctex = true
inputs = [{ inline = '\RequirePackage[OT1]{fontenc}\input{main.tex}' }]
```

Set `extra_paths = ["."]` in `[doc]` when the sources are in the project root rather than `src/`.
For Unicode fonts, follow [Tectonic's font setup](https://tectonic-typesetting.github.io/book/latest/getting-started/unicode.html).

PDF/source navigation uses the standard `synctex` command from TeX Live (MacTeX or BasicTeX on
macOS) or MiKTeX. Install it on the machine that owns the project. PDF viewing and chat proposals
remain available without it.

## Your Paper workspace

Paper keeps its own projects, chats, settings and credentials. It does not import T3 Code's
account or connections, or access its Keychain items. The local Paper server stores its data
in `~/.t3-paper`, separately from T3 Code.

To work on another machine, add its Paper server in Settings → Connections.
PDF builds and paper proposals run on the machine that owns the project.

## Comment on the paper

Select text in the PDF and click the comment button. The comment is added to your message with
the matching `.tex` lines, the same way a code review comment is. Send it to ask the agent for
changes.

Yellow highlights mark comments in your message draft. Removing a comment removes its highlight.

Each comment includes the exact PDF text you selected as well as the matching source context,
so short instructions such as "delete this part" retain their target.

## Pick a rewrite

The agent makes closely specified edits directly, such as deleting a marked passage or following
wording you sketch. Generic feedback such as "awkward" or "make this clearer" leads to options
for your approval; one option is enough.
Proposals are highlighted on the PDF and shown in the chat.

Click a highlighted passage or its **Review change** button to open the alternatives. You can still
drag to select text and comment on it. Use **View in PDF** in the chat to jump to the passage and
open its popup. New proposals open there automatically while you are working in Paper. If the passage
cannot be located in the current PDF, the proposal stays available in the chat.

The popup shows the original and one selected alternative side by side. Switch options at the top;
long passages scroll inside each text pane. Red marks the original; green marks the proposed text.

Agents can also place interactive option cards directly in their replies, between short explanations.
Choose and apply an option there, or use **View in PDF** to review the passage on the paper.

Inline math and displayed equations render in the preview. If a command is unsupported, the preview
shows an error and its LaTeX source. The compiled paper PDF remains the reference for final typesetting.

- Click **Apply** to update the `.tex` file and rebuild the PDF. The proposal is marked applied;
  nothing is added to your message draft and no extra agent turn is needed.
- Type in **Reply** to send feedback. Closely specified edits are direct; generic feedback returns
  as revised options for approval.
- Dismiss a proposal you don't want.

A proposal goes stale if its original text changes before you apply it.

## Agent tools

Agents can call `paper_status` to rebuild and read compile errors, and `paper_propose_edits` to
offer alternatives.
