import type { PaperDiagnostic } from "@t3tools/contracts";

export function parseDiagnostics(output: string, cwd: string): PaperDiagnostic[] {
  const diagnostics: PaperDiagnostic[] = [];
  // Compiler color escapes must not become part of file names or diagnostic text.
  const plain = output.replaceAll(new RegExp(`${String.fromCharCode(27)}\\[[\\d;]*m`, "g"), "");
  for (const raw of plain.split(/\r?\n/)) {
    const prefixed = /^(error|warning):\s*(.*)$/.exec(raw.trim());
    const located = /^(.*?\.(?:tex|bib|sty|cls|bst)):(\d+):\s*(.*)$/.exec(
      prefixed?.[2] ?? raw.trim(),
    );
    const tex = /^(?:!\s*|(?:LaTeX|Package\s+\S+|Class\s+\S+)\s+Warning:\s*)(.*)$/.exec(raw);
    if (!prefixed && !located && !tex && !/^(?:Over|Under)full \\[hv]box/.test(raw)) continue;
    const message = located?.[3] ?? prefixed?.[2] ?? tex?.[1] ?? raw.trim();
    const severity =
      prefixed?.[1] === "error" ||
      raw.startsWith("!") ||
      (located && !prefixed && !/warning/i.test(message))
        ? "error"
        : "warning";
    const lineMatch = /(?:on input line|at lines?)\s+(\d+)/.exec(message);
    const line = located ? Number(located[2]) : lineMatch ? Number(lineMatch[1]) : undefined;
    const file = located?.[1]
      ?.replaceAll("\\", "/")
      .replace(`${cwd.replaceAll("\\", "/")}/`, "")
      .replace(/^\.\//, "");
    const diagnostic: PaperDiagnostic = {
      severity,
      message,
      ...(file === undefined ? {} : { file }),
      ...(line === undefined || line < 1 ? {} : { line }),
    };
    if (!diagnostics.some((other) => JSON.stringify(other) === JSON.stringify(diagnostic)))
      diagnostics.push(diagnostic);
  }
  return diagnostics;
}
