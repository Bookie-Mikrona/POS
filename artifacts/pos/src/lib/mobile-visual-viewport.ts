function isEditableElement(element: Element | null): element is HTMLElement {
  return element instanceof HTMLElement && (
    element.matches("input, textarea, select, [contenteditable='true']")
  );
}

function focusFirstEditable(container: Element): void {
  if (container.contains(document.activeElement) && isEditableElement(document.activeElement)) return;

  const candidates = container.querySelectorAll<HTMLElement>(
    "[autofocus], input:not([type='hidden']):not([disabled]), textarea:not([disabled]), select:not([disabled]), [contenteditable='true']",
  );
  const firstVisible = Array.from(candidates).find(element => (
    element.getAttribute("aria-hidden") !== "true"
    && element.getClientRects().length > 0
  ));
  firstVisible?.focus({ preventScroll: true });
}

export function setupMobileVisualViewport(): () => void {
  const viewport = window.visualViewport;
  const root = document.documentElement;
  let focusTimer: number | undefined;
  const handleFocusIn = () => {
    revealFocusedField();
  };

  const revealFocusedField = () => {
    window.clearTimeout(focusTimer);
    focusTimer = window.setTimeout(() => {
      const active = document.activeElement;
      if (!isEditableElement(active)) return;

      const visibleTop = viewport?.offsetTop ?? 0;
      const visibleBottom = visibleTop + (viewport?.height ?? window.innerHeight);
      const rect = active.getBoundingClientRect();
      if (rect.top < visibleTop + 16 || rect.bottom > visibleBottom - 16) {
        active.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      }
    }, 180);
  };

  const updateViewport = () => {
    root.style.setProperty(
      "--pos-visual-viewport-height",
      `${Math.round(viewport?.height ?? window.innerHeight)}px`,
    );
    root.style.setProperty(
      "--pos-visual-viewport-offset-top",
      `${Math.round(viewport?.offsetTop ?? 0)}px`,
    );
    revealFocusedField();
  };

  const focusNewInput = (container: Element) => {
    if (container.hasAttribute("data-pos-keyboard-autofocus-disabled")) return;
    // MutationObserver runs in the same user interaction turn, kar Androidu
    // omogoči, da ob programskem fokusu odpre tudi zaslonsko tipkovnico.
    queueMicrotask(() => focusFirstEditable(container));
  };

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (
        mutation.type === "attributes"
        && mutation.target instanceof Element
        && mutation.target.matches("[role='dialog'][data-state='open']")
      ) {
        focusNewInput(mutation.target);
      }
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        const container = node.matches("[role='dialog'][data-state='open'], [data-pos-keyboard-overlay]")
          ? node
          : node.querySelector("[role='dialog'][data-state='open'], [data-pos-keyboard-overlay]");
        if (container) focusNewInput(container);
      }
    }
  });

  updateViewport();
  viewport?.addEventListener("resize", updateViewport);
  viewport?.addEventListener("scroll", updateViewport);
  window.addEventListener("resize", updateViewport);
  document.addEventListener("focusin", handleFocusIn);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-state"],
  });

  return () => {
    window.clearTimeout(focusTimer);
    viewport?.removeEventListener("resize", updateViewport);
    viewport?.removeEventListener("scroll", updateViewport);
    window.removeEventListener("resize", updateViewport);
    document.removeEventListener("focusin", handleFocusIn);
    observer.disconnect();
  };
}