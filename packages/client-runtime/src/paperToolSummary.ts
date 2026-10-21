export function paperRewriteCount(
  calls: ReadonlyArray<{ readonly input: Record<string, unknown> | undefined }>,
): number {
  return calls.reduce(
    (total, call) => total + (Array.isArray(call.input?.options) ? call.input.options.length : 0),
    0,
  );
}
