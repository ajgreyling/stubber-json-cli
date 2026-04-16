/** Encode path segments as JSON Pointer (RFC 6901) */
export function joinPointer(...segments: string[]): string {
  return (
    "/" +
    segments
      .map((s) =>
        s.replace(/~/g, "~0").replace(/\//g, "~1"),
      )
      .join("/")
  );
}
