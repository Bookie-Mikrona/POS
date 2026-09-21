import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setupMobileVisualViewport } from "./lib/mobile-visual-viewport";
import { setupPosAutofillPolicy } from "./lib/pos-autofill-policy";

// ResizeObserver loop error je benigna Chrome napaka — Vite overlay jo napačno prikaže
// kot fatal error. Prestrežemo jo v capturing phase (pred Vite listener-jem) in jo tiho ignoriramo.
window.addEventListener(
  "error",
  (e) => {
    if (
      e.message === "ResizeObserver loop completed with undelivered notifications." ||
      e.message === "ResizeObserver loop limit exceeded"
    ) {
      e.stopImmediatePropagation();
    }
  },
  true, // capturing phase — izvede se pred bubble-phase Vite listener-jem
);

setupMobileVisualViewport();
setupPosAutofillPolicy();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
    });
  });
}

createRoot(document.getElementById("root")!).render(<App />);
