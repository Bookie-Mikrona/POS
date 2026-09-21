export function getRemovedCapabilities(current: readonly string[], next: readonly string[]): string[] {
  const selected = new Set(next);
  return current.filter(capability => !selected.has(capability));
}