import type { PaperDiagnostic } from "@t3tools/contracts";

const MAX_DIAGNOSTICS = 50;

const LOCATED_ERROR = /^((?:[A-Za-z]:)?[^:\s][^:]*\.(?:tex|sty|cls|bib|bbl|ltx|def)):(\d+): (.+)$/;
const TEX_ERROR = /^! (.+)$/;
const WARNING = /^(?:LaTeX|Package \S+|Class \S+) Warning: (.+)$/;
const INPUT_LINE = /on input line (\d+)\.?$/;

/** Errors and warnings from a TeX log, and the `file:line: message` errors Tectonic prints. */
export function parseDiagnostics(output: string, cwd: string): PaperDiagnostic[] {
  const lines = output.split(/\r?\n/);
  const diagnostics = new Map<string, PaperDiagnostic>();
  const add = (diagnostic: PaperDiagnostic) => {
    const key = `${diagnostic.severity}:${diagnostic.file}:${diagnostic.line}:${diagnostic.message}`;
    if (!diagnostics.has(key)) diagnostics.set(key, diagnostic);
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trimEnd();
    const located = LOCATED_ERROR.exec(line);
    if (located) {
      add({
        severity: "error",
        message: located[3]!,
        file: workspacePath(located[1]!, cwd),
        line: Number(located[2]),
      });
      continue;
    }
    const error = TEX_ERROR.exec(line);
    if (error) {
      add({ severity: "error", message: error[1]! });
      continue;
    }
    const warning = WARNING.exec(line);
    if (!warning) continue;
    // TeX wraps warnings onto lines that start with the package name in parentheses.
    let message = warning[1]!;
    while (/^\([\w@.-]+\)\s/.test(lines[index + 1] ?? "")) {
      message += ` ${lines[++index]!.replace(/^\([\w@.-]+\)\s+/, "").trim()}`;
    }
    const inputLine = INPUT_LINE.exec(message)?.[1];
    add({
      severity: "warning",
      message: message.replace(INPUT_LINE, "").trim(),
      ...(inputLine ? { line: Number(inputLine) } : {}),
    });
  }
  return [...diagnostics.values()]
    .toSorted((a, b) => Number(b.severity === "error") - Number(a.severity === "error"))
    .slice(0, MAX_DIAGNOSTICS);
}

function workspacePath(file: string, cwd: string) {
  const normalized = file.replaceAll("\\", "/");
  const root = `${cwd.replaceAll("\\", "/")}/`;
  return (normalized.startsWith(root) ? normalized.slice(root.length) : normalized).replace(
    /^\.\//,
    "",
  );
}
