type PosNavigate = (to: string, options?: any) => void;
type PosNavigationBlocker = (navigate: PosNavigate, to: string, options?: any) => boolean;

const navigationBlockers = new Set<PosNavigationBlocker>();
const HISTORY_INDEX_KEY = "__bookiePosHistoryIndex";
const HISTORY_STATE_VALUE_KEY = "__bookiePosOriginalHistoryState";

type BlockedHistoryTraversal = {
  fromIndex: number;
  toIndex: number;
  resumeRequested: boolean;
  restoring: boolean;
  cancelled: boolean;
};

let currentHistoryIndex = 0;
let historyTraversal: BlockedHistoryTraversal | null = null;
let historyTrackingInstalled = false;

function readHistoryIndex(state: unknown): number | null {
  if (!state || typeof state !== "object") return null;
  const index = (state as Record<string, unknown>)[HISTORY_INDEX_KEY];
  return Number.isSafeInteger(index) ? index as number : null;
}

function withHistoryIndex(state: unknown, index: number): object {
  if (state && typeof state === "object" && !Array.isArray(state)) {
    const prototype = Object.getPrototypeOf(state);
    if (prototype === Object.prototype || prototype === null) {
      return { ...(state as Record<string, unknown>), [HISTORY_INDEX_KEY]: index };
    }
  }
  return {
    [HISTORY_INDEX_KEY]: index,
    [HISTORY_STATE_VALUE_KEY]: state,
  };
}

function getNavigationApiIndex(): number | null {
  const navigation = (window as Window & {
    navigation?: { currentEntry?: { index?: number } };
  }).navigation;
  const index = navigation?.currentEntry?.index;
  return Number.isSafeInteger(index) ? index as number : null;
}

function stopPopState(event: PopStateEvent) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function resumeBlockedTraversal(traversal: BlockedHistoryTraversal) {
  if (historyTraversal !== traversal) return;
  traversal.resumeRequested = true;
  if (!traversal.restoring) {
    window.history.go(traversal.toIndex - traversal.fromIndex);
  }
}

function cancelBlockedTraversal(traversal: BlockedHistoryTraversal) {
  if (historyTraversal !== traversal) return;
  if (traversal.restoring) {
    traversal.cancelled = true;
  } else {
    historyTraversal = null;
  }
}

function handlePopState(event: PopStateEvent) {
  const eventIndex = readHistoryIndex(event.state) ?? getNavigationApiIndex();
  const traversal = historyTraversal;

  if (traversal) {
    if (traversal.resumeRequested && eventIndex === traversal.toIndex) {
      currentHistoryIndex = traversal.toIndex;
      historyTraversal = null;
      return;
    }

    if (traversal.restoring && eventIndex === traversal.fromIndex) {
      stopPopState(event);
      currentHistoryIndex = traversal.fromIndex;
      traversal.restoring = false;
      if (traversal.resumeRequested) {
        window.history.go(traversal.toIndex - traversal.fromIndex);
      } else if (traversal.cancelled) {
        historyTraversal = null;
      }
      return;
    }

    // Ignore additional Back/Forward presses while the warning is open. Keep
    // the original requested destination and restore the browser to this page.
    stopPopState(event);
    if (eventIndex !== null && eventIndex !== traversal.fromIndex) {
      traversal.restoring = true;
      window.history.go(traversal.fromIndex - eventIndex);
    }
    return;
  }

  if (eventIndex === null) return;
  if (eventIndex === currentHistoryIndex) return;

  if (navigationBlockers.size === 0) {
    currentHistoryIndex = eventIndex;
    return;
  }

  const nextTraversal: BlockedHistoryTraversal = {
    fromIndex: currentHistoryIndex,
    toIndex: eventIndex,
    resumeRequested: false,
    restoring: true,
    cancelled: false,
  };
  const destination = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const navigationOptions = {
    posHistoryTraversal: true,
    cancelPosHistoryTraversal: () => cancelBlockedTraversal(nextTraversal),
  };

  let blocked = false;
  for (const blocker of navigationBlockers) {
    if (blocker(
      () => resumeBlockedTraversal(nextTraversal),
      destination,
      navigationOptions,
    )) {
      blocked = true;
      break;
    }
  }

  if (!blocked) {
    currentHistoryIndex = eventIndex;
    return;
  }

  historyTraversal = nextTraversal;
  stopPopState(event);
  window.history.go(nextTraversal.fromIndex - nextTraversal.toIndex);
}

function installHistoryTracking() {
  if (historyTrackingInstalled || typeof window === "undefined" || !window.history) return;
  historyTrackingInstalled = true;

  const history = window.history;
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  currentHistoryIndex = readHistoryIndex(history.state) ?? getNavigationApiIndex() ?? 0;

  if (readHistoryIndex(history.state) === null) {
    originalReplaceState.call(
      history,
      withHistoryIndex(history.state, currentHistoryIndex),
      "",
      window.location.href,
    );
  }

  history.pushState = function (data: any, unused: string, url?: string | URL | null) {
    const nextIndex = currentHistoryIndex + 1;
    const result = originalPushState.call(this, withHistoryIndex(data, nextIndex), unused, url);
    currentHistoryIndex = nextIndex;
    return result;
  };

  history.replaceState = function (data: any, unused: string, url?: string | URL | null) {
    const result = originalReplaceState.call(
      this,
      withHistoryIndex(data, currentHistoryIndex),
      unused,
      url,
    );
    return result;
  };

  window.addEventListener("popstate", handlePopState, true);
}

installHistoryTracking();

export function registerPosNavigationBlocker(blocker: PosNavigationBlocker): () => void {
  installHistoryTracking();
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
