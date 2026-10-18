import { useCallback, useEffect, useRef } from "react";

const warning = "Seznama neuspešnih knjiženj ni mogoče shraniti. Če odidete, ga boste izgubili. Ali želite vseeno zapustiti stran?";

/** Wouter uses the History API, including for programmatic navigation. */
export function useBankImportLeaveGuard(enabled: boolean) {
  const releaseRef = useRef<() => void>(() => {});
  const confirmLeave = useCallback(() => {
    if (!enabled) return true;
    if (!window.confirm(warning)) return false;
    releaseRef.current();
    return true;
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const history = window.history;
    const push = history.pushState;
    const replace = history.replaceState;
    const currentUrl = window.location.href;
    const currentState = history.state;
    let active = true;
    const approve = () => {
      if (!active) return true;
      if (!window.confirm(warning)) return false;
      release();
      return true;
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const guardedPush: History["pushState"] = function (this: History, ...args) {
      if (approve()) push.apply(this, args);
    };
    const guardedReplace: History["replaceState"] = function (this: History, ...args) {
      if (approve()) replace.apply(this, args);
    };
    const popState = (event: PopStateEvent) => {
      if (approve()) return;
      // Restore the page before Wouter's bubble listener can unmount it.
      event.stopImmediatePropagation();
      push.call(history, currentState, "", currentUrl);
    };
    const click = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank"
        || anchor.hasAttribute("download") || event.button !== 0
        || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      if (!approve()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    function release() {
      active = false;
      if (history.pushState === guardedPush) history.pushState = push;
      if (history.replaceState === guardedReplace) history.replaceState = replace;
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("popstate", popState, true);
      document.removeEventListener("click", click, true);
    }
    history.pushState = guardedPush;
    history.replaceState = guardedReplace;
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("popstate", popState, true);
    document.addEventListener("click", click, true);
    releaseRef.current = release;
    return release;
  }, [enabled]);

  return confirmLeave;
}
