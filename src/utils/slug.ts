/** Safe path segment for action/state keys */
export function safeSegment(key: string): string {
  return key.replace(/[/\\?*:|"<>]/g, "_");
}

export function taskFilePrefix(order: number | string): string {
  const o = String(typeof order === "number" && Number.isFinite(order) ? order : order);
  return o.replace(/\./g, "p");
}
