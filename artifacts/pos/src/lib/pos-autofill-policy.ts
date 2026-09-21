const SEMANTIC_INPUT_TYPES = new Set(["email", "tel", "password"]);

function applyAutofillPolicy(root: ParentNode): void {
  const elements: Array<HTMLInputElement | HTMLTextAreaElement> = [];
  if (root instanceof HTMLInputElement || root instanceof HTMLTextAreaElement) {
    elements.push(root);
  }
  elements.push(...root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"));

  for (const element of elements) {
    if (element.hasAttribute("autocomplete")) continue;
    if (element instanceof HTMLInputElement && SEMANTIC_INPUT_TYPES.has(element.type)) continue;
    element.setAttribute("autocomplete", "off");
  }
}

export function setupPosAutofillPolicy(): () => void {
  applyAutofillPolicy(document);

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof Element) applyAutofillPolicy(node);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  return () => observer.disconnect();
}