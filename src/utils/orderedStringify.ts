/**
 * Pretty-print JSON with explicit key order per object path (JSON Pointer).
 * Arrays preserve element order.
 */
export function stringifyWithKeyOrders(
  value: unknown,
  indentSize: number,
  keyOrders: Record<string, string[]>,
  path = "",
): string {
  const indent = " ".repeat(indentSize);
  return stringifyInner(value, 0, path, indentSize, indent, keyOrders);
}

function stringifyInner(
  value: unknown,
  depth: number,
  path: string,
  indentSize: number,
  indentStr: string,
  keyOrders: Record<string, string[]>,
): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const pad = indentStr.repeat(depth + 1);
    const closePad = indentStr.repeat(depth);
    const parts = value.map((item) =>
      stringifyInner(item, depth + 1, `${path}/-`, indentSize, indentStr, keyOrders),
    );
    return `[\n${pad}${parts.join(`,\n${pad}`)}\n${closePad}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const order = keyOrders[path];
    const keys = order ?? Object.keys(obj);
    const seen = new Set<string>();
    const orderedKeys: string[] = [];
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) {
        orderedKeys.push(k);
        seen.add(k);
      }
    }
    for (const k of Object.keys(obj)) {
      if (!seen.has(k)) orderedKeys.push(k);
    }
    if (orderedKeys.length === 0) return "{}";
    const pad = indentStr.repeat(depth + 1);
    const closePad = indentStr.repeat(depth);
    const parts: string[] = [];
    for (const k of orderedKeys) {
      const childPath = path === "" ? `/${k}` : `${path}/${escapePointerSegment(k)}`;
      const keyJson = JSON.stringify(k);
      const v = stringifyInner(
        obj[k],
        depth + 1,
        childPath,
        indentSize,
        indentStr,
        keyOrders,
      );
      parts.push(`${keyJson}: ${v}`);
    }
    return `{\n${pad}${parts.join(`,\n${pad}`)}\n${closePad}}`;
  }
  return JSON.stringify(value);
}

function escapePointerSegment(s: string): string {
  return s.replace(/~/g, "~0").replace(/\//g, "~1");
}
