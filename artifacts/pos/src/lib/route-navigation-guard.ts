type PosNavigate = (to: string, options?: any) => void;
type PosNavigationBlocker = (navigate: PosNavigate, to: string, options?: any) => boolean;

const navigationBlockers = new Set<PosNavigationBlocker>();

export function registerPosNavigationBlocker(blocker: PosNavigationBlocker): () => void {
  navigationBlockers.add(blocker);
  return () => navigationBlockers.delete(blocker);
}

export function aroundPosNavigation(
  navigate: PosNavigate,
  to: string,
  options?: any,
): void {
  for (const blocker of navigationBlockers) {
    if (blocker(navigate, to, options)) return;
  }
  if (options === undefined) navigate(to);
  else navigate(to, options);
}
