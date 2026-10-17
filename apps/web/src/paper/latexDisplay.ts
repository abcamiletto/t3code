export type DisplayNode =
  | { kind: "text" | "math" | "muted"; text: string }
  | { kind: "italic" | "bold"; children: DisplayNode[] };

export function latexToDisplay(latex: string): DisplayNode[] {
  const nodes: DisplayNode[] = [];
  let index = 0;
  const text = (value: string) => {
    const last = nodes.at(-1);
    if (last?.kind === "text") last.text += value;
    else nodes.push({ kind: "text", text: value });
  };
  while (index < latex.length) {
    const rest = latex.slice(index);
    const math = /^\$((?:\\.|[^$])+)\$/.exec(rest);
    if (math) {
      nodes.push({ kind: "math", text: math[1]! });
      index += math[0].length;
      continue;
    }
    const command = /^\\([a-zA-Z]+)\*?(?:\[[^\]]*\])?\s*/.exec(rest);
    if (command) {
      const name = command[1]!;
      index += command[0].length;
      if (latex[index] !== "{") continue;
      const start = ++index;
      let depth = 1;
      while (index < latex.length && depth > 0) {
        if (latex[index] === "\\") {
          index += 2;
          continue;
        }
        if (latex[index] === "{") depth++;
        if (latex[index] === "}") depth--;
        if (depth > 0) index++;
      }
      const contents = latex.slice(start, index);
      index++;
      if (name.startsWith("cite") || /^(?:eqref|ref|autoref|pageref)$/.test(name)) {
        nodes.push({ kind: "muted", text: name.startsWith("cite") ? "[cite]" : "[ref]" });
      } else if (name === "emph" || name === "textit" || name === "textbf") {
        nodes.push({
          kind: name === "textbf" ? "bold" : "italic",
          children: latexToDisplay(contents),
        });
      } else {
        for (const node of latexToDisplay(contents)) nodes.push(node);
      }
      continue;
    }
    const escaped = /^\\([{}%$&#_~\\])/.exec(rest);
    if (escaped) {
      text(escaped[1] === "\\" ? "\n" : escaped[1]!);
      index += escaped[0].length;
      continue;
    }
    const character = latex[index++]!;
    if (character !== "{" && character !== "}") text(character === "~" ? "\u00a0" : character);
  }
  return nodes;
}
