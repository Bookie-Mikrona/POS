export {
  UNIT_CAPABILITY_DEPENDENCIES,
  getMissingCapabilityDependencies,
  capabilityDependencyMessage,
} from "@workspace/db/unit-capability-policy";

export function getRemovedCapabilities(current: readonly string[], next: readonly string[]): string[] {
  const selected = new Set(next);
  return current.filter(capability => !selected.has(capability));
}