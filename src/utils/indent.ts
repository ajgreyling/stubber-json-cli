/** Detect indentation from first indented line in JSON text */
export function detectIndentSize(fileContent: string): number {
  const lines = fileContent.split(/\n/);
  for (const line of lines) {
    const m = /^(\s+)\S/.exec(line);
    if (m) return m[1].length;
  }
  return 2;
}
